// ---------------------------------------------------------------------------
// Collector - polite HTTP client.
//
// Rules enforced here:
//   * only http(s) GET requests to public pages;
//   * an explicit timeout on every request, so a hung host cannot stall CI;
//   * a small, bounded retry with backoff for transient failures only;
//   * a minimum gap between requests (rate limiting) and an honest User-Agent;
//   * **no** login, cookies, CAPTCHA solving, header spoofing to look like a
//     browser, or any other access-control bypass. If a page starts requiring
//     authentication we surface an error and stop - we do not work around it.
//
// SSRF / DNS-rebinding hardening:
//   * every hostname is resolved once per request, and every returned address
//     is classified. Any loopback, private, link-local, CGNAT, multicast,
//     reserved or documentation address rejects the whole hostname;
//   * DNS failures fail closed (an unverifiable host is never treated as safe);
//   * redirects are followed manually and each hop is re-validated and re-pinned;
//   * validated addresses are passed to the connector via a custom `lookup`
//     function so connections can only reach pinned addresses. SNI and the
//     HTTP Host header use the original hostname; TLS peer verification is
//     not disabled.
//   * no second DNS lookup occurs at connection time for pinned hostnames
//     (rebinding gap closed for this transport path).
//
// Residual limitations:
//   * This relies on the connector's lookup hook; it does not protect code
//     paths that bypass this module.
//   * It does not replace network-level egress restrictions.
// ---------------------------------------------------------------------------

import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv6ToBigInt(ip) {
  try {
    let normalized = ip.toLowerCase();
    // Handle IPv4-mapped/compatible/embedded forms in expanded or compressed form
    const embeddedV4Match = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (embeddedV4Match) {
      const v4 = embeddedV4Match[1];
      const parts4 = v4.split(".").map((p) => parseInt(p, 10));
      if (parts4.length === 4 && parts4.every((n) => !Number.isNaN(n))) {
        const v4hex = ((parts4[0] << 8) | parts4[1]).toString(16).padStart(4, "0") + ":" + ((parts4[2] << 8) | parts4[3]).toString(16).padStart(4, "0");
        normalized = normalized.replace(/(\d+\.\d+\.\d+\.\d+)$/, v4hex);
      }
    }
    const parts = normalized.split(":");
    let full = [];
    const idx = parts.indexOf("");
    if (idx !== -1) {
      const left = parts.slice(0, idx).filter((p) => p !== "");
      const right = parts.slice(idx + 1).filter((p) => p !== "");
      const missing = 8 - left.length - right.length;
      for (let i = 0; i < left.length; i++) full.push(left[i] || "0");
      for (let i = 0; i < missing; i++) full.push("0");
      for (let i = 0; i < right.length; i++) full.push(right[i] || "0");
    } else {
      full = parts;
    }
    if (full.length !== 8) return null;
    let num = 0n;
    for (let i = 0; i < 8; i++) {
      const val = parseInt(full[i] || "0", 16);
      if (Number.isNaN(val)) return null;
      num = (num << 16n) | BigInt(val);
    }
    return num;
  } catch {
    return null;
  }
}

function ipv6InRange(ip, prefix, prefixLen) {
  const num = ipv6ToBigInt(ip);
  if (num === null) return false;
  const pnum = ipv6ToBigInt(prefix);
  if (pnum === null) return false;
  if (prefixLen === 0) return true;
  if (prefixLen >= 128) return num === pnum;
  const shift = 128n - BigInt(prefixLen);
  return (num >> shift) === (pnum >> shift);
}

// Globally reachable IANA entries that are more specific than non-global ranges.
// For a generic read-only HTTP(S) web scraper (SSRF-sensitive), allow only
// addresses that are normal public unicast destinations. Protocol-specific
// anycast/special-use prefixes (PCP/TURN/DNS-SD anycast 2001:1::1/2/3,
// AMT 2001:3::/32, AS112-v6 2001:4:112::/48, ORCHIDv2 2001:20::/28,
// Drone Remote ID DETs 2001:30::/28) are not required to fetch public web
// pages and expand the SSRF attack surface; all are denied regardless of
// IANA "globally reachable" flags in the special-purpose registry.
const IANA_GLOBALLY_REACHABLE_IPV6_EXCEPTIONS = [];

export const DEFAULT_USER_AGENT =
  "JNTUHNotes-AlertCollector/1.0 (+https://jntuh.ac.in; read-only; contact via project README)";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_GAP_MS = 1_500;
export const DEFAULT_MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(message, { url, status = 0, cause } = {}) {
    super(message);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  if (ms === undefined || ms === null) return promise;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message || `Operation timed out after ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------
export let _dnsLookup = dnsLookup;
export function _setDnsLookup(fn) {
  _dnsLookup = fn || dnsLookup;
}

function activeLookup() {
  return typeof _dnsLookup === "function" ? _dnsLookup : dnsLookup;
}

let _transport = null;
let _allowTransportOverride = false;

function isTestEnvironment() {
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.VITEST) return true;
  if (process.env.JEST_WORKER_ID) return true;
  if (process.env.NODE_TEST_CONTEXT) return true;
  if (process.env.npm_lifecycle_event && process.env.npm_lifecycle_event.includes("test")) return true;
  // Also check if we're running under node:tes
  try {
    const { getCallSites } = require("node:util");
    // Not available in all Node versions, ignore
  } catch {}
  return false;
}

// Only allow transport override in explicit test mode. Tests must call
// _enableTransportOverride() to opt in; production usage is blocked.
export function _enableTransportOverride() {
  if (!isTestEnvironment()) {
    throw new Error("Transport override is only allowed in test mode");
  }
  _allowTransportOverride = true;
}

export function _setTransport(fn) {
  if (!isTestEnvironment() || !_allowTransportOverride) {
    throw new Error("Transport override is only allowed in test mode");
  }
  _transport = typeof fn === "function" ? fn : null;
}

export function _clearTransportOverride() {
  _transport = null;
  if (isTestEnvironment()) {
    _allowTransportOverride = false;
  }
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

export function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  let normalized = typeof ip === "string" ? ip.trim().toLowerCase() : "";
  if (!normalized) return true;

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }

  if (normalized === "localhost") return true;

  const version = isIP(normalized);
  if (version === 0) return true;

  if (version === 4) {
    const parts = normalized.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b, c, d] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) {
      // IANA Special-Purpose: 192.0.0.0/24 except 192.0.0.9 and 192.0.0.10 (RFC 6890/6333) - treat as globally reachable exceptions if presen
      if ((c === 0 && d === 9) || (c === 0 && d === 10)) return false;
      return true;
    }
    if (a === 198 && b === 18) return true; // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 19) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 31 && c === 196) return true;
    if (a === 192 && b === 52 && c === 193) return true;
    if (a === 192 && b === 88 && c === 99) return true;
    if (a === 192 && b === 175 && c === 48) return true;
    if (a === 198 && b === 175 && c === 155) return true;
    if (a === 239) return true; // multicas
    if (a >= 240) return true; // reserved
    if (a >= 224) return true;
    return false;
  }

  if (normalized === "::") return true;
  if (normalized === "::1") return true;
  if (normalized === "0:0:0:0:0:0:0:1") return true;
  {
    const groups = normalized.split(":");
    if (
      groups.length === 8 &&
      groups.slice(0, 7).every((g) => /^0+$/.test(g)) &&
      /^0*1$/.test(groups[7])
    ) {
      return true;
    }
  }

  const mapped = normalized.match(/^::ffff:(.+)$/);
  if (mapped) {
    const embedded = mapped[1];
    if (isIP(embedded) === 4) return isPrivateOrReservedIp(embedded);
    // expanded form might have no leading ::
    const hexParts = embedded.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (Number.isNaN(hi) || Number.isNaN(lo)) return true;
      const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
      return isPrivateOrReservedIp(v4);
    }
    // try to extract v4 if present
    const mv4 = embedded.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
    if (mv4 && isIP(mv4[1]) === 4) return isPrivateOrReservedIp(mv4[1]);
    return true;
  }

  const compatible = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compatible) return isPrivateOrReservedIp(compatible[1]);
  if (normalized.includes("::")) {
    const mV4 = normalized.match(/::([0-9.]+)$/);
    if (mV4 && isIP(mV4[1]) === 4) return isPrivateOrReservedIp(mV4[1]);
    const hexm = normalized.match(/^::([0-9a-f]{0,4}):([0-9a-f]{0,4})$/);
    if (hexm) {
      const hi = parseInt(hexm[1] || "0", 16);
      const lo = parseInt(hexm[2] || "0", 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
        if (isIP(v4) === 4) return isPrivateOrReservedIp(v4);
      }
      return true;
    }
    if (normalized.includes(".")) {
      const mv4 = normalized.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
      if (mv4 && isIP(mv4[1]) === 4) return isPrivateOrReservedIp(mv4[1]);
    }
  } else {
    // expanded forms
    if (normalized.match(/^0000:0000:0000:0000:0000:ffff:/)) {
      const parts6 = normalized.split(":");
      if (parts6.length >= 8) {
        const hi = parseInt(parts6[6] || "0", 16);
        const lo = parseInt(parts6[7] || "0", 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
          if (isIP(v4) === 4) return isPrivateOrReservedIp(v4);
        }
        return true;
      }
    }
    if (normalized.match(/^0000:0000:0000:0000:0000:0000:/)) {
      const parts6 = normalized.split(":");
      if (parts6.length >= 8) {
        const hi = parseInt(parts6[6] || "0", 16);
        const lo = parseInt(parts6[7] || "0", 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
          if (isIP(v4) === 4) return isPrivateOrReservedIp(v4);
        }
        return true;
      }
    }
  }

  // Check exceptions first
  if (IANA_GLOBALLY_REACHABLE_IPV6_EXCEPTIONS.some(([prefix, prefixLen]) =>
    ipv6InRange(normalized, prefix, prefixLen)
  )) return false;

  // Non-global/unassigned ranges (IANA guidance)
  // IANA marks 2001::/23 non-global unless a more-specific allocation
  // establishes a globally reachable exception listed above.
  if (ipv6InRange(normalized, "2001::", 23)) return true;

  if (ipv6InRange(normalized, "2d00::", 8)) return true;
  if (ipv6InRange(normalized, "2e00::", 7)) return true;
  if (ipv6InRange(normalized, "3000::", 4)) return true; // 3000::/4 often unassigned/reserved in many policies; be conservative
  if (ipv6InRange(normalized, "3ffe::", 16)) return true;
  if (ipv6InRange(normalized, "4000::", 3)) return true;

  // Special-purpose / non-global
  if (ipv6InRange(normalized, "fc00::", 7)) return true;
  if (ipv6InRange(normalized, "fe80::", 10)) return true;
  if (ipv6InRange(normalized, "fec0::", 10)) return true;
  if (ipv6InRange(normalized, "ff00::", 8)) return true;
  if (ipv6InRange(normalized, "2001:db8::", 32)) return true;
  if (ipv6InRange(normalized, "2001:0::", 32)) return true;
  if (ipv6InRange(normalized, "2002::", 16)) return true;
  if (ipv6InRange(normalized, "2001:1::", 32)) return true;
  if (ipv6InRange(normalized, "2001:2::", 48)) return true;
  if (ipv6InRange(normalized, "2001:5::", 32)) return true;
  if (ipv6InRange(normalized, "2001:10::", 28)) return true; // ORCHID
  if (ipv6InRange(normalized, "2001:6::", 32)) return true; // be conservative unless proven globally reachable in current allocations
  if (ipv6InRange(normalized, "64:ff9b:1::", 48)) return true; // translation
  // The globally reachable NAT64 prefix carries an IPv4 destination in its low 32 bits.
  if (ipv6InRange(normalized, "64:ff9b::", 96)) {
    const embeddedV4 = Number(ipv6ToBigInt(normalized) & 0xffffffffn);
    const address = [
      embeddedV4 >>> 24,
      (embeddedV4 >>> 16) & 0xff,
      (embeddedV4 >>> 8) & 0xff,
      embeddedV4 & 0xff,
    ].join(".");
    return isPrivateOrReservedIp(address);
  }
  if (ipv6InRange(normalized, "100::", 64)) return true;
  if (ipv6InRange(normalized, "5f00::", 16)) return true;
  if (ipv6InRange(normalized, "3fff::", 20)) return true;

  // Only allow known globally reachable unicast space in 2000::/3 that are not blocked above
  if (ipv6InRange(normalized, "2000::", 3)) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Resolution + validation
// ---------------------------------------------------------------------------

export async function resolveValidatedAddresses(hostname, url, timeoutMs) {
  let results;
  try {
    const lookupPromise = activeLookup()(hostname, { all: true });
    results = timeoutMs !== undefined ? await withTimeout(lookupPromise, timeoutMs, `DNS resolution timed out for ${hostname}`) : await lookupPromise;
  } catch (cause) {
    if (cause?.name === "TimeoutError") {
      throw new HttpError(`DNS resolution timed out for ${hostname}`, { url, cause });
    }
    throw new HttpError(`DNS resolution failed for ${hostname}`, { url, cause });
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new HttpError(`DNS resolution returned no addresses for ${hostname}`, { url });
  }

  const addresses = [];
  for (const entry of results) {
    const address = typeof entry === "string" ? entry : entry && entry.address;
    if (typeof address !== "string" || isIP(address) === 0) {
      throw new HttpError(`DNS resolution returned an invalid address for ${hostname}`, { url });
    }
    if (isPrivateOrReservedIp(address)) {
      throw new HttpError(
        `Refusing connection to disallowed address for ${hostname}: ${address}`,
        { url },
      );
    }
    addresses.push(address);
  }

  return addresses;
}

export async function isDisallowedHost(hostname, url = "", timeoutMs) {
  if (!hostname) return true;

  let host = String(hostname).trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost") return true;

  if (isIP(host) !== 0) return isPrivateOrReservedIp(host);
  if (host.includes(":")) return true;

  try {
    await resolveValidatedAddresses(host, url, timeoutMs);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Connection-time pinning
// ---------------------------------------------------------------------------

export function createPinnedLookup(pinned) {
  return function pinnedLookup(hostname, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    opts = opts || {};

    const key = String(hostname).trim().toLowerCase();
    const addresses = pinned instanceof Map ? pinned.get(key) : undefined;

    const fail = (message, code = "ENOTFOUND") => {
      const err = new Error(message);
      err.code = code;
      if (typeof cb === "function") {
        process.nextTick(cb, err);
        return undefined;
      }
      throw err;
    };

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return fail(`No validated address pinned for ${hostname}`, "ENOTFOUND");
    }

    const safe = [];
    for (const address of addresses) {
      if (isIP(address) === 0 || isPrivateOrReservedIp(address)) {
        return fail(`Pinned address is not safe for ${hostname}: ${address}`, "EACCES");
      }
      safe.push(address);
    }

    let usable = safe;
    if (opts.family === 4) {
      usable = safe.filter((a) => isIP(a) === 4);
      if (usable.length === 0) {
        return fail(`No IPv4 address pinned for ${hostname}`, "EAFNOSUPPORT");
      }
    } else if (opts.family === 6) {
      usable = safe.filter((a) => isIP(a) === 6);
      if (usable.length === 0) {
        return fail(`No IPv6 address pinned for ${hostname}`, "EAFNOSUPPORT");
      }
    }

    if (opts.all) {
      const list = usable.map((address) => ({ address, family: isIP(address) }));
      if (typeof cb === "function") {
        process.nextTick(cb, null, list);
        return undefined;
      }
      return list;
    }

    const first = usable[0];
    if (typeof cb === "function") {
      process.nextTick(cb, null, first, isIP(first));
      return undefined;
    }
    return { address: first, family: isIP(first) };
  };
}

export const _tlsOptions = Object.freeze({
  rejectUnauthorized: true,
});

// ---------------------------------------------------------------------------
// Request transpor
// ---------------------------------------------------------------------------

function defaultTransport(url, { headers, timeoutMs, pinned, signal }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const hostname = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

    const options = {
      protocol: parsed.protocol,
      hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
      lookup: createPinnedLookup(pinned),
      servername: hostname.replace(/^\[|\]$/g, ""),
      rejectUnauthorized: _tlsOptions.rejectUnauthorized,
      agent: false,
    };

    let settled = false;
    let req;
    let activeResponse = null;
    let onAbort = null;
    const cleanup = () => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };
    const fail = (err, response = activeResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        response?.destroy();
      } catch {
        // ignore
      }
      try {
        req?.destroy();
      } catch {
        // ignore
      }
      reject(err);
    };
    const reqOptionsCallback = (res) => {
      activeResponse = res;
      const chunks = [];
      let receivedBytes = 0;
      let responseEnded = false;
      const declaredLength = res.headers?.["content-length"];
      res.on("error", (err) => fail(err, res));
      res.on("aborted", () => {
        fail(new HttpError(`Response interrupted: ${url}`, { url, status: res.statusCode || 0 }), res);
      });
      res.on("close", () => {
        if (!responseEnded) {
          fail(new HttpError(`Response interrupted: ${url}`, { url, status: res.statusCode || 0 }), res);
        }
      });

      if (
        typeof declaredLength === "string" &&
        /^\d+$/.test(declaredLength) &&
        Number(declaredLength) > MAX_RESPONSE_BYTES
      ) {
        const err = new HttpError(
          `Response exceeds maximum size of ${MAX_RESPONSE_BYTES} bytes: ${url}`,
          { url, status: res.statusCode || 0 },
        );
        err.code = "ERR_RESPONSE_TOO_LARGE";
        fail(err, res);
        return;
      }

      res.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          const err = new HttpError(
            `Response exceeds maximum size of ${MAX_RESPONSE_BYTES} bytes: ${url}`,
            { url, status: res.statusCode || 0 },
          );
          err.code = "ERR_RESPONSE_TOO_LARGE";
          fail(err, res);
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        if (settled) return;
        responseEnded = true;
        if (res.complete === false) {
          fail(new HttpError(`Response interrupted: ${url}`, { url, status: res.statusCode || 0 }), res);
          return;
        }
        settled = true;
        cleanup();
        const body = Buffer.concat(chunks).toString("utf8");
        const headersObj = {
          get(name) {
            const key = String(name).toLowerCase();
            const val = res.headers[key];
            if (Array.isArray(val)) return val.join(", ");
            if (val === undefined || val === null) return null;
            return String(val);
          },
        };
        resolve({
          status: res.statusCode || 0,
          headers: headersObj,
          body,
          bodyBytes: receivedBytes,
        });
      });
    };
    req = lib.request(options, reqOptionsCallback);

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    const abort = () => {
      if (settled) return;
      const err = new Error("Timeout");
      err.name = "TimeoutError";
      fail(err);
    };

    const timeout = typeof timeoutMs === "number" && timeoutMs >= 0 ? timeoutMs : undefined;
    if (timeout !== undefined) {
      req.setTimeout(timeout, abort);
    }

    if (signal) {
      onAbort = () => {
        abort();
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    if (!settled) req.end();
  });
}

async function performRequest(url, headers, timeoutMs, pinned, signal) {
  if (typeof _transport === "function") {
    return _transport(url, { headers, timeoutMs, pinned, signal });
  }
  return defaultTransport(url, { headers, timeoutMs, pinned, signal });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export function createRateLimiter(gapMs = DEFAULT_GAP_MS) {
  let nextAt = 0;
  return async function waitTurn() {
    const now = Date.now();
    const wait = nextAt - now;
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + Math.max(0, gapMs);
  };
}

function backoffMs(attempt) {
  return 500 * 2 ** attempt;
}

export function looksLikeAccessWall(html) {
  const head = String(html ?? "").slice(0, 4000).toLowerCase();
  return (
    head.includes("captcha") ||
    head.includes("cf-challenge") ||
    head.includes("access denied") ||
    head.includes("please sign in") ||
    head.includes("rate limit exceeded")
  );
}

async function validateAndPin(rawUrl, pinned, timeoutMs) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(`Not a valid URL: ${rawUrl}`, { url: rawUrl });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(`Refusing non-http(s) URL: ${rawUrl}`, { url: rawUrl });
  }

  let host = parsed.hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost") {
    throw new HttpError(`Refusing request to disallowed host: ${rawUrl}`, { url: rawUrl });
  }

  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new HttpError(`Refusing request to disallowed host: ${rawUrl}`, { url: rawUrl });
    }
    return parsed;
  }

  if (host.includes(":")) {
    throw new HttpError(`Refusing request to disallowed host: ${rawUrl}`, { url: rawUrl });
  }

  const addresses = await resolveValidatedAddresses(host, rawUrl, timeoutMs);
  pinned.set(host, addresses);
  return parsed;
}

function getOrigin(urlString) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const SAFE_CROSS_ORIGIN_HEADERS = new Set([
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
  "range",
  "if-modified-since",
  "if-none-match",
  "cache-control",
]);

function filterHeadersForRedirect(headers, fromUrl, toUrl) {
  const fromOrigin = getOrigin(fromUrl);
  const toOrigin = getOrigin(toUrl);
  if (!fromOrigin || !toOrigin || fromOrigin === toOrigin) {
    return headers;
  }
  const filtered = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();
    if (key === "host") continue;
    if (SAFE_CROSS_ORIGIN_HEADERS.has(key)) {
      filtered[k] = v;
    }
    // Do not forward arbitrary caller-supplied headers or any credential-like headers
  }
  return filtered;
}

export async function fetchText(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    gap,
    headers = {},
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = options;

  const deadline = Date.now() + timeoutMs;

  const pinned = new Map();
  let requestHeaders = {
    "user-agent": DEFAULT_USER_AGENT,
    accept,
    "accept-language": "en-IN,en;q=0.9",
    ...headers,
  };

  let currentUrl = url;
  let redirects = 0;
  let lastError = null;

  const remaining = () => deadline - Date.now();

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const rem = remaining();
      if (rem <= 0) {
        const err = new Error(`Operation timed out after ${timeoutMs}ms: ${currentUrl}`);
        err.name = "TimeoutError";
        throw new HttpError(err.message, { url: currentUrl, cause: err });
      }
      try {
        await withTimeout(validateAndPin(currentUrl, pinned, rem), rem, `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
      } catch (cause) {
        if (cause?.name === "TimeoutError" && !(cause instanceof HttpError)) {
          throw new HttpError(`Request timed out after ${timeoutMs}ms: ${currentUrl}`, { url: currentUrl, cause });
        }
        throw cause;
      }

      if (gap) {
        const g = remaining();
        if (g <= 0) {
          const err = new Error(`Operation timed out after ${timeoutMs}ms: ${currentUrl}`);
          err.name = "TimeoutError";
          throw new HttpError(err.message, { url: currentUrl, cause: err });
        }
        await withTimeout(gap(), g, `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
      }

      let response;
      try {
        const rem2 = remaining();
        if (rem2 <= 0) {
          const err = new Error(`Operation timed out after ${timeoutMs}ms: ${currentUrl}`);
          err.name = "TimeoutError";
          throw err;
        }
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), Math.max(1, rem2));
        try {
          response = await withTimeout(
            performRequest(currentUrl, requestHeaders, Math.max(1, rem2), pinned, controller.signal),
            rem2,
            `Request timed out after ${timeoutMs}ms: ${currentUrl}`
          );
        } finally {
          clearTimeout(t);
        }
      } catch (cause) {
        if (cause?.code === "ERR_RESPONSE_TOO_LARGE") {
          throw cause;
        }
        const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
        lastError = new HttpError(
          timedOut
            ? `Request timed out after ${timeoutMs}ms: ${currentUrl}`
            : `Request failed: ${currentUrl} (${cause?.code || cause?.name || "error"})`,
          { url: currentUrl, cause },
        );
        if (timedOut) break;
        if (attempt < retries) {
          const remB = remaining();
          if (remB <= 0) {
            const errT = new Error(`Request timed out after ${timeoutMs}ms: ${currentUrl}`);
            errT.name = "TimeoutError";
            throw new HttpError(errT.message, { url: currentUrl, cause: errT });
          }
          await withTimeout(sleep(backoffMs(attempt)), remB, `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
          continue;
        }
        throw lastError;
      }

      const declaredLength = response.headers?.get?.("content-length");
      const bodyBytes = Number.isFinite(response.bodyBytes)
        ? response.bodyBytes
        : Buffer.byteLength(
          typeof response.body === "string"
            ? response.body
            : Buffer.isBuffer(response.body)
              ? response.body
              : String(response.body ?? ""),
        );
      if (
        (typeof declaredLength === "string" && /^\d+$/.test(declaredLength) &&
          Number(declaredLength) > MAX_RESPONSE_BYTES) ||
        bodyBytes > MAX_RESPONSE_BYTES
      ) {
        const err = new HttpError(
          `Response exceeds maximum size of ${MAX_RESPONSE_BYTES} bytes: ${currentUrl}`,
          { url: currentUrl, status: response.status },
        );
        err.code = "ERR_RESPONSE_TOO_LARGE";
        throw err;
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new HttpError(`Redirect with no location from ${currentUrl}`, {
            url: currentUrl,
            status: response.status,
          });
        }

        redirects += 1;
        if (redirects > maxRedirects) {
          throw new HttpError(`Too many redirects (>${maxRedirects}) from ${currentUrl}`, {
            url: currentUrl,
            status: response.status,
          });
        }

        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl).href;
        } catch {
          throw new HttpError(`Invalid redirect location from ${currentUrl}`, {
            url: currentUrl,
            status: response.status,
          });
        }

        if (nextUrl === currentUrl) {
          throw new HttpError(`Redirect loop detected from ${currentUrl}`, {
            url: currentUrl,
            status: response.status,
          });
        }

        const remR = remaining();
        if (remR <= 0) {
          const err = new Error(`Operation timed out after ${timeoutMs}ms: ${currentUrl}`);
          err.name = "TimeoutError";
          throw new HttpError(err.message, { url: currentUrl, status: response.status, cause: err });
        }
        try {
          await withTimeout(validateAndPin(nextUrl, pinned, remR), remR, `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
        } catch (cause) {
          if (cause?.name === "TimeoutError" && !(cause instanceof HttpError)) {
            throw new HttpError(`Request timed out after ${timeoutMs}ms: ${currentUrl}`, { url: currentUrl, status: response.status, cause });
          }
          throw cause;
        }
        requestHeaders = filterHeadersForRedirect(requestHeaders, currentUrl, nextUrl);

        currentUrl = nextUrl;
        attempt = -1;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const status = response.status;
        if (status === 401 || status === 403 || status === 407 || status === 429 || status === 511) {
          throw new HttpError(
            `Access denied by the source (HTTP ${status}). Not attempting to bypass it: ${currentUrl}`,
            { url: currentUrl, status },
          );
        }
        if (status >= 500 && attempt < retries) {
          const remS = remaining();
          if (remS <= 0) {
            const errT = new Error(`Operation timed out after ${timeoutMs}ms: ${currentUrl}`);
            errT.name = "TimeoutError";
            throw new HttpError(errT.message, { url: currentUrl, status, cause: errT });
          }
          await withTimeout(sleep(backoffMs(attempt)), remS, `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
          continue;
        }
        throw new HttpError(`HTTP ${status} fetching ${currentUrl}`, { url: currentUrl, status });
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !/text\/|xml|json/.test(contentType)) {
        throw new HttpError(`Unexpected content type "${contentType}" from ${currentUrl}`, {
          url: currentUrl,
          status: response.status,
        });
      }

      return response.body;
    }

    throw lastError ?? new HttpError(`Failed to fetch ${url}`, { url });
  } catch (err) {
    if (err?.name === "TimeoutError" && !(err instanceof HttpError)) {
      throw new HttpError(`Request timed out after ${timeoutMs}ms: ${currentUrl}`, { url: currentUrl, cause: err });
    }
    throw err;
  }
}
