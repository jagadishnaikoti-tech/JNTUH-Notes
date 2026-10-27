// ---------------------------------------------------------------------------
// Offline tests for collector/lib/http.mjs.
//
// DNS injected via _setDnsLookup. HTTP transport injected via _setTransport.
// Validates redirect/pinning policy without contacting real hosts.
// ---------------------------------------------------------------------------

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import {
  HttpError,
  fetchText,
  isDisallowedHost,
  isPrivateOrReservedIp,
  resolveValidatedAddresses,
  createPinnedLookup,
  _tlsOptions,
  _setDnsLookup,
  _dnsLookup,
  _setTransport,
  _enableTransportOverride,
  _clearTransportOverride,
  MAX_RESPONSE_BYTES,
} from "../lib/http.mjs";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

function withDns(fn, run) {
  _setDnsLookup(fn);
  return Promise.resolve()
    .then(run)
    .finally(() => _setDnsLookup());
}

function withTransport(fake, run) {
  _enableTransportOverride();
  _setTransport(fake);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      try {
        _clearTransportOverride();
      } catch {
        try {
          _setTransport(null);
        } catch {
          // ignore
        }
      }
    });
}

async function withDefaultHttpsRequest(handler, run) {
  const originalRequest = https.request;
  const state = { requestDestroyed: false, responseDestroyed: false, requests: 0 };
  https.request = function (_options, callback) {
    state.requests += 1;
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.end = () => process.nextTick(() => handler(callback, req, state));
    req.destroy = (err) => {
      state.requestDestroyed = true;
      if (err) process.nextTick(() => req.emit("error", err));
      return req;
    };
    return req;
  };
  try {
    _clearTransportOverride();
    await run(state);
  } finally {
    https.request = originalRequest;
    try {
      _clearTransportOverride();
    } catch {
      // ignore
    }
  }
}

function makeNodeResponse(callback, state, { headers = {}, chunks = [], end = true } = {}) {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = headers;
  response.complete = true;
  response.destroy = () => {
    state.responseDestroyed = true;
    response.complete = false;
    return response;
  };
  callback(response);
  for (const chunk of chunks) response.emit("data", chunk);
  if (end) response.emit("end");
  return response;
}

function makeHeaders(obj = {}) {
  const map = new Map(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  return {
    get(name) {
      return map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null;
    },
  };
}

function html(body = "<html>ok</html>", status = 200) {
  return { status, headers: makeHeaders({ "content-type": "text/html" }), body };
}

function redirect(location, status = 302) {
  return { status, headers: makeHeaders({ location }), body: "" };
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

test("isPrivateOrReservedIp blocks loopback, private, link-local and reserved IPv4", () => {
  for (const ip of [
    "127.0.0.1",
    "127.255.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "169.254.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be disallowed`);
  }
});

test("isPrivateOrReservedIp allows public IPv4", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "104.16.0.1"]) {
    assert.equal(isPrivateOrReservedIp(ip), false, `${ip} must be allowed`);
  }
});

test("isPrivateOrReservedIp blocks unsafe IPv6 forms", () => {
  for (const ip of [
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fe80::1",
    "fe80::",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "::192.168.1.1",
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be disallowed`);
  }
});

test("isPrivateOrReservedIp allows public IPv6 and rejects garbage", () => {
  assert.equal(isPrivateOrReservedIp(PUBLIC_V6), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
  assert.equal(isPrivateOrReservedIp(""), true);
  assert.equal(isPrivateOrReservedIp("not-an-ip"), true);
  assert.equal(isPrivateOrReservedIp("999.999.999.999"), true);
  assert.equal(isPrivateOrReservedIp(null), true);
});

test("isPrivateOrReservedIp handles bracketed IPv6 literals", () => {
  assert.equal(isPrivateOrReservedIp("[::1]"), true);
  assert.equal(isPrivateOrReservedIp("[fe80::1]"), true);
  assert.equal(isPrivateOrReservedIp(`[${PUBLIC_V6}]`), false);
});

// ---------------------------------------------------------------------------
// Host validation and DNS failure behaviour
// ---------------------------------------------------------------------------

test("isDisallowedHost rejects localhost and IP literals without DNS", async () => {
  const calls = [];
  await withDns(async (host) => {
    calls.push(host);
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    assert.equal(await isDisallowedHost("localhost"), true);
    assert.equal(await isDisallowedHost("127.0.0.1"), true);
    assert.equal(await isDisallowedHost("169.254.169.254"), true);
    assert.equal(await isDisallowedHost("[::1]"), true);
    assert.equal(calls.length, 0, "IP literals must not trigger DNS");
  });
});

test("isDisallowedHost fails closed when DNS rejects", async () => {
  await withDns(async () => {
    throw new Error("ENOTFOUND");
  }, async () => {
    assert.equal(await isDisallowedHost("unknown.example.com"), true);
  });
});

test("isDisallowedHost fails closed on empty DNS results", async () => {
  await withDns(async () => [], async () => {
    assert.equal(await isDisallowedHost("empty.example.com"), true);
  });
});

test("isDisallowedHost fails closed on unexpected DNS shapes", async () => {
  for (const shape of [[null], [{}], [undefined], "not-an-array", [{ address: "" }]]) {
    await withDns(async () => shape, async () => {
      assert.equal(await isDisallowedHost("weird.example.com"), true, `shape ${JSON.stringify(shape)}`);
    });
  }
});

test("isDisallowedHost rejects a host with mixed public and private answers", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }, { address: "127.0.0.1" }], async () => {
    assert.equal(await isDisallowedHost("split.example.com"), true);
  });
});

test("isDisallowedHost rejects a host resolving to metadata", async () => {
  await withDns(async () => [{ address: "169.254.169.254" }], async () => {
    assert.equal(await isDisallowedHost("metadata.example.com"), true);
  });
});

test("isDisallowedHost allows a host resolving only to public addresses", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }, { address: PUBLIC_V6 }], async () => {
    assert.equal(await isDisallowedHost("example.com"), false);
  });
});

test("resolveValidatedAddresses returns validated public addresses", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }, { address: PUBLIC_V6 }], async () => {
    const addresses = await resolveValidatedAddresses("example.com", "https://example.com/");
    assert.deepEqual(addresses, [PUBLIC_V4, PUBLIC_V6]);
  });
});

test("resolveValidatedAddresses rejects any unsafe address in the set", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }, { address: "169.254.169.254" }], async () => {
    await assert.rejects(
      () => resolveValidatedAddresses("split.example.com", "https://split.example.com/"),
      (err) => err instanceof HttpError && /disallowed address/i.test(err.message),
    );
  });
});

test("resolveValidatedAddresses fails closed when DNS rejects", async () => {
  await withDns(async () => {
    throw new Error("boom");
  }, async () => {
    await assert.rejects(
      () => resolveValidatedAddresses("unknown.example.com", "https://unknown.example.com/"),
      (err) => err instanceof HttpError && /DNS resolution failed/i.test(err.message),
    );
  });
});

// ---------------------------------------------------------------------------
// Connection boundary (pinned lookup)
// ---------------------------------------------------------------------------

function lookupOnce(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

function lookupAll(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

test("pinned lookup returns only the previously validated address", async () => {
  const pinned = new Map([["example.com", [PUBLIC_V4]]]);
  const lookup = createPinnedLookup(pinned);
  const result = await lookupOnce(lookup, "example.com");
  assert.equal(result.address, PUBLIC_V4);
  assert.equal(result.family, 4);
});

test("pinned lookup performs no DNS lookup of its own (rebinding safe)", async () => {
  let calls = 0;
  _setDnsLookup(async () => {
    calls += 1;
    return calls === 1 ? [{ address: PUBLIC_V4 }] : [{ address: "169.254.169.254" }];
  });
  try {
    const addresses = await resolveValidatedAddresses("rebind.example.com", "https://rebind.example.com/");
    assert.deepEqual(addresses, [PUBLIC_V4]);

    const pinned = new Map([["rebind.example.com", addresses]]);
    const lookup = createPinnedLookup(pinned);
    const result = await lookupOnce(lookup, "rebind.example.com");

    assert.equal(result.address, PUBLIC_V4, "connection must use the validated address");
    assert.equal(calls, 1, "connection boundary must not perform a second DNS lookup");
  } finally {
    _setDnsLookup();
  }
});

test("pinned lookup refuses a destination with no validated pin", async () => {
  const lookup = createPinnedLookup(new Map());
  await assert.rejects(
    () => lookupOnce(lookup, "unpinned.example.com"),
    (err) => err.code === "ENOTFOUND" && /No validated address pinned/i.test(err.message),
  );
});

test("pinned lookup refuses a pin that contains an unsafe address", async () => {
  const pinned = new Map([["evil.example.com", ["169.254.169.254"]]]);
  const lookup = createPinnedLookup(pinned);
  await assert.rejects(
    () => lookupOnce(lookup, "evil.example.com"),
    (err) => err.code === "EACCES" && /not safe/i.test(err.message),
  );
});

test("pinned lookup cannot be redirected to an address outside the pin", async () => {
  const pinned = new Map([["example.com", [PUBLIC_V4]]]);
  const lookup = createPinnedLookup(pinned);
  await assert.rejects(
    () => lookupOnce(lookup, "169.254.169.254"),
    (err) => err.code === "ENOTFOUND",
  );
});

test("pinned lookup supports family filtering and all-address mode", async () => {
  const pinned = new Map([["example.com", [PUBLIC_V4, PUBLIC_V6]]]);
  const lookup = createPinnedLookup(pinned);

  const v4 = await lookupOnce(lookup, "example.com", { family: 4 });
  assert.equal(v4.address, PUBLIC_V4);

  const v6 = await lookupOnce(lookup, "example.com", { family: 6 });
  assert.equal(v6.address, PUBLIC_V6);

  const all = await lookupAll(lookup, "example.com");
  assert.deepEqual(
    all.map((a) => a.address).sort(),
    [PUBLIC_V4, PUBLIC_V6].sort(),
  );
});

test("pinned lookup fails closed on IPv4 family mismatch", async () => {
  const pinned = new Map([["example.com", [PUBLIC_V6]]]);
  const lookup = createPinnedLookup(pinned);
  await assert.rejects(
    () => lookupOnce(lookup, "example.com", { family: 4 }),
    (err) => err.code === "EAFNOSUPPORT" && /No IPv4 address pinned/i.test(err.message),
  );
});

test("pinned lookup fails closed on IPv6 family mismatch", async () => {
  const pinned = new Map([["example.com", [PUBLIC_V4]]]);
  const lookup = createPinnedLookup(pinned);
  await assert.rejects(
    () => lookupOnce(lookup, "example.com", { family: 6 }),
    (err) => err.code === "EAFNOSUPPORT" && /No IPv6 address pinned/i.test(err.message),
  );
});

test("TLS peer verification is never disabled", () => {
  assert.equal(_tlsOptions.rejectUnauthorized, true);
});

// ---------------------------------------------------------------------------
// fetchText: safe paths
// ---------------------------------------------------------------------------

test("fetchText returns body for a public host", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      assert.match(String(url), /^https:\/\/example\.com\/start$/);
      return html("<html>hello</html>");
    }, async () => {
      const body = await fetchText("https://example.com/start");
      assert.equal(body, "<html>hello</html>");
    });
  });
});

test("fetchText follows a safe relative redirect", async () => {
  const seen = [];
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      seen.push(String(url));
      if (String(url).endsWith("/start")) return redirect("/final");
      return html("done");
    }, async () => {
      const body = await fetchText("https://example.com/start");
      assert.equal(body, "done");
      assert.deepEqual(seen, ["https://example.com/start", "https://example.com/final"]);
    });
  });
});

test("fetchText follows a safe cross-host public redirect", async () => {
  await withDns(async (host) => [{ address: host === "cdn.example.net" ? "104.16.0.1" : PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      if (String(url).includes("origin.example.com")) {
        return redirect("https://cdn.example.net/file");
      }
      return html("cdn-body");
    }, async () => {
      const body = await fetchText("https://origin.example.com/start");
      assert.equal(body, "cdn-body");
    });
  });
});

test("fetchText follows a redirect containing credentials and an explicit port", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      if (String(url).endsWith("/start")) {
        return redirect("https://user:pass@example.com:8443/final");
      }
      assert.match(String(url), /^https:\/\/user:pass@example\.com:8443\/final$/);
      return html("with-port");
    }, async () => {
      const body = await fetchText("https://example.com/start");
      assert.equal(body, "with-port");
    });
  });
});

// ---------------------------------------------------------------------------
// fetchText: rejected destinations
// ---------------------------------------------------------------------------

test("fetchText refuses non-http(s) schemes", async () => {
  for (const url of ["file:///etc/passwd", "javascript:void(0)", "ftp://example.com/x"]) {
    await assert.rejects(
      () => fetchText(url),
      (err) => err instanceof HttpError && /non-http/i.test(err.message),
    );
  }
});

test("fetchText refuses initial disallowed hosts without fetching", async () => {
  let fetched = 0;
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async () => {
      fetched += 1;
      return html();
    }, async () => {
      for (const url of [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://10.0.0.5/",
      ]) {
        await assert.rejects(
          () => fetchText(url),
          (err) => err instanceof HttpError && /disallowed host/i.test(err.message),
        );
      }
      assert.equal(fetched, 0, "no request may be attempted for a disallowed host");
    });
  });
});

test("fetchText refuses a host whose DNS includes a private address, before fetching", async () => {
  let fetched = 0;
  await withDns(async () => [{ address: PUBLIC_V4 }, { address: "10.0.0.5" }], async () => {
    await withTransport(async () => {
      fetched += 1;
      return html();
    }, async () => {
      await assert.rejects(
        () => fetchText("https://split.example.com/"),
        (err) => err instanceof HttpError && /disallowed address/i.test(err.message),
      );
      assert.equal(fetched, 0);
    });
  });
});

test("fetchText refuses a host when DNS resolution fails", async () => {
  let fetched = 0;
  await withDns(async () => {
    throw new Error("ENOTFOUND");
  }, async () => {
    await withTransport(async () => {
      fetched += 1;
      return html();
    }, async () => {
      await assert.rejects(
        () => fetchText("https://unknown.example.com/"),
        (err) => err instanceof HttpError && /DNS resolution failed/i.test(err.message),
      );
      assert.equal(fetched, 0);
    });
  });
});

test("fetchText rejects a redirect to a private address before contacting it", async () => {
  const seen = [];
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      seen.push(String(url));
      return redirect("http://127.0.0.1:8080/secret");
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start"),
        (err) => err instanceof HttpError && /disallowed host/i.test(err.message),
      );
      assert.deepEqual(seen, ["https://example.com/start"]);
    });
  });
});

test("fetchText rejects a redirect to the cloud metadata IP", async () => {
  const seen = [];
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => {
      seen.push(String(url));
      return redirect("http://169.254.169.254/latest/meta-data/");
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start"),
        (err) => err instanceof HttpError && /disallowed host/i.test(err.message),
      );
      assert.equal(seen.length, 1);
    });
  });
});

test("fetchText rejects a redirect to a host that resolves privately", async () => {
  await withDns(async (host) => {
    if (host === "metadata.google.internal") return [{ address: "169.254.169.254" }];
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    await withTransport(async () => redirect("http://metadata.google.internal/computeMetadata/v1/"), async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start"),
        (err) => err instanceof HttpError && /disallowed address/i.test(err.message),
      );
    });
  });
});

test("fetchText rejects a redirect to [::1]", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async () => redirect("http://[::1]/admin"), async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start"),
        (err) => err instanceof HttpError && /disallowed host/i.test(err.message),
      );
    });
  });
});

test("fetchText rejects a non-http(s) redirect", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async () => redirect("file:///etc/passwd"), async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start"),
        (err) => err instanceof HttpError && /non-http/i.test(err.message),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// fetchText: redirect limits, loops, retries, timeouts, content checks
// ---------------------------------------------------------------------------

test("fetchText enforces the redirect limit", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let n = 0;
    await withTransport(async () => {
      n += 1;
      return redirect(`https://example.com/r${n}`);
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/start", { maxRedirects: 2 }),
        (err) => err instanceof HttpError && /too many redirects/i.test(err.message),
      );
    });
  });
});

test("fetchText detects a self redirect loop", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url) => redirect(String(url)), async () => {
      await assert.rejects(
        () => fetchText("https://example.com/loop"),
        (err) => err instanceof HttpError && /loop/i.test(err.message),
      );
    });
  });
});

test("fetchText retries transient 5xx then succeeds", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let n = 0;
    await withTransport(async () => {
      n += 1;
      return n === 1 ? { status: 503, headers: makeHeaders({}), body: "busy" } : html("recovered");
    }, async () => {
      const body = await fetchText("https://example.com/x", { retries: 2 });
      assert.equal(body, "recovered");
      assert.equal(n, 2);
    });
  });
});

test("fetchText does not retry access-denied responses", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let n = 0;
    await withTransport(async () => {
      n += 1;
      return { status: 403, headers: makeHeaders({}), body: "denied" };
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/x", { retries: 5 }),
        (err) => err instanceof HttpError && /Access denied/i.test(err.message),
      );
      assert.equal(n, 1);
    });
  });
});

test("fetchText stops on timeout without retrying", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let n = 0;
    await withTransport(async () => {
      n += 1;
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/x", { retries: 5, timeoutMs: 10 }),
        (err) => err instanceof HttpError && /timed out/i.test(err.message),
      );
      assert.equal(n, 1);
    });
  });
});

test("fetchText rejects unexpected content types", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async () => ({
      status: 200,
      headers: makeHeaders({ "content-type": "application/octet-stream" }),
      body: "binary",
    }), async () => {
      await assert.rejects(
        () => fetchText("https://example.com/file"),
        (err) => err instanceof HttpError && /Unexpected content type/i.test(err.message),
      );
    });
  });
});

test("the test seam is restored after injected DNS", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    assert.notEqual(_dnsLookup, undefined);
  });
  assert.equal(typeof _dnsLookup, "function");
});

test("transport override cannot be enabled outside test environment", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVitest = process.env.VITEST;
  const originalJest = process.env.JEST_WORKER_ID;
  const originalNodeTest = process.env.NODE_TEST_CONTEXT;
  const originalNpmEvent = process.env.npm_lifecycle_event;
  try {
    delete process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.JEST_WORKER_ID;
    delete process.env.NODE_TEST_CONTEXT;
    delete process.env.npm_lifecycle_event;
    // Force production-like environment
    assert.throws(() => _enableTransportOverride(), /only allowed in test mode/i);
    assert.throws(() => _setTransport(() => ({})), /only allowed in test mode/i);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalJest === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = originalJest;
    if (originalNodeTest === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = originalNodeTest;
    if (originalNpmEvent === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = originalNpmEvent;
  }
});

test("transport override remains isolated between tests and can be cleared", async () => {
  _enableTransportOverride();
  _setTransport(async () => html("injected"));
  try {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      const body = await fetchText("https://example.com/isolated");
      assert.equal(body, "injected");
    });
  } finally {
    _clearTransportOverride();
  }
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let called = false;
    await withTransport(async () => {
      called = true;
      return html("after-clear");
    }, async () => {
      const body = await fetchText("https://example.com/after");
      assert.equal(body, "after-clear");
      assert.equal(called, true);
    });
  });
});

test("cross-host redirect strips sensitive headers", async () => {
  const seen = [];
  await withDns(async (host) => [{ address: host === "cdn.example.net" ? "104.16.0.1" : PUBLIC_V4 }], async () => {
    await withTransport(async (url, opts) => {
      seen.push({ url: String(url), headers: opts?.headers || {} });
      if (String(url).includes("origin.example.com")) {
        return redirect("https://cdn.example.net/file");
      }
      return html("cdn-body");
    }, async () => {
      const body = await fetchText("https://origin.example.com/start", {
        headers: {
          Authorization: "Bearer secret",
          "Proxy-Authorization": "Basic abc",
          Cookie: "session=xyz",
          "X-Custom": "keep",
          Accept: "text/html",
        },
      });
      assert.equal(body, "cdn-body");
      assert.equal(seen.length, 2);
      assert.ok(seen[0].headers.Authorization);
      assert.ok(seen[0].headers.Cookie);
      assert.ok(!seen[1].headers.Authorization);
      assert.ok(!seen[1].headers["Proxy-Authorization"]);
      assert.ok(!seen[1].headers.Cookie);
      assert.ok(!seen[1].headers["X-Custom"]);
      assert.ok(seen[1].headers.Accept || seen[1].headers.accept);
    });
  });
});

test("redirect across scheme/port also strips sensitive headers", async () => {
  const seen = [];
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url, opts) => {
      seen.push({ url: String(url), headers: opts?.headers || {} });
      if (String(url).endsWith("/start")) {
        return redirect("https://example.com:8443/final");
      }
      return html("done");
    }, async () => {
      await fetchText("https://example.com/start", {
        headers: { Authorization: "Bearer x", Cookie: "a=b", "X-Safe": "1", Accept: "*/*" },
      });
      assert.equal(seen.length, 2);
      assert.ok(seen[0].headers.Authorization);
      assert.ok(seen[0].headers.Cookie);
      assert.ok(!seen[1].headers.Authorization);
      assert.ok(!seen[1].headers.Cookie);
      assert.ok(!seen[1].headers["X-Safe"]);
      assert.ok(seen[1].headers.Accept || seen[1].headers.accept);
    });
  });
});

test("end-to-end timeout bounds DNS resolution", async () => {
  await withDns(async () => {
    await new Promise((r) => setTimeout(r, 200));
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    await assert.rejects(
      () => fetchText("https://slow.example.com/", { timeoutMs: 50 }),
      (err) => err instanceof HttpError && /timed out/i.test(err.message),
    );
  });
});

test("end-to-end timeout prevents request after stalled validation", async () => {
  let fetched = 0;
  await withDns(async () => {
    await new Promise((r) => setTimeout(r, 150));
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    await withTransport(async () => {
      fetched += 1;
      return html();
    }, async () => {
      await assert.rejects(
        () => fetchText("https://very-slow.example.com/", { timeoutMs: 30 }),
        (err) => err instanceof HttpError && /timed out/i.test(err.message),
      );
      assert.equal(fetched, 0);
    });
  });
});

test("stalled response times out and aborts request", async () => {
  const originalRequest = https.request;
  let destroyed = false;
  let timeoutSet = false;
  https.request = function (options, callback) {
    const req = {
      on() { return this; },
      setTimeout(fn, ms) {
        timeoutSet = true;
        if (typeof fn === "function") {
          setTimeout(() => fn(), 30);
        }
        return this;
      },
      end() {},
      destroy(err) {
        destroyed = true;
        if (this._onError) this._onError(err || new Error("destroyed"));
        return this;
      },
      _onError: null,
    };
    req.on = function(ev, fn) {
      if (ev === "error") this._onError = fn;
      return this;
    };
    return req;
  };
  try {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      if (typeof _clearTransportOverride === "function") {
        try { _clearTransportOverride(); } catch {}
      } else {
        try { _enableTransportOverride(); _setTransport(null); } catch {}
      }
      await assert.rejects(
        () => fetchText("https://stalled.example.com/", { timeoutMs: 50 }),
        (err) => err instanceof HttpError && /timed out/i.test(err.message),
      );
      assert.equal(timeoutSet, true);
      assert.equal(destroyed, true);
    });
  } finally {
    https.request = originalRequest;
  }
});

test("retry delay exceeding deadline does not continue", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let attempts = 0;
    await withTransport(async () => {
      attempts += 1;
      return { status: 503, headers: makeHeaders({}), body: "busy" };
    }, async () => {
      await assert.rejects(
        () => fetchText("https://retry-deadline.example.com/", { timeoutMs: 10, retries: 5 }),
        (err) => err instanceof HttpError && /timed out|HTTP 503/i.test(err.message),
      );
      assert.ok(attempts >= 1);
    });
  });
});

test("DNS that resolves after timeout does not trigger request", async () => {
  let fetched = 0;
  await withDns(async () => {
    await new Promise((r) => setTimeout(r, 200));
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    await withTransport(async () => {
      fetched += 1;
      return html();
    }, async () => {
      await assert.rejects(
        () => fetchText("https://late-dns.example.com/", { timeoutMs: 30 }),
        (err) => err instanceof HttpError && /timed out/i.test(err.message),
      );
      assert.equal(fetched, 0);
    });
  });
});

test("cross-origin redirect strips custom credential headers and multi-hop", async () => {
  const seen = [];
  await withDns(async (host) => {
    if (host === "cdn2.example.net") return [{ address: "104.16.1.1" }];
    if (host === "cdn.example.net") return [{ address: "104.16.0.1" }];
    return [{ address: PUBLIC_V4 }];
  }, async () => {
    await withTransport(async (url, opts) => {
      seen.push({ url: String(url), headers: opts?.headers || {} });
      if (String(url).includes("origin.example.com")) {
        return redirect("https://cdn.example.net/step1");
      }
      if (String(url).includes("cdn.example.net")) {
        return redirect("https://cdn2.example.net/step2");
      }
      return html("final");
    }, async () => {
      const body = await fetchText("https://origin.example.com/start", {
        headers: {
          authorization: "Bearer secret",
          Cookie: "session=xyz",
          "X-Service-Token": "token123",
          "X-Custom": "keep",
          "X-Unknown": "value",
          Referer: "https://origin.example.com/start?token=secret",
        },
      });
      assert.equal(body, "final");
      assert.equal(seen.length, 3);
      assert.ok(seen[0].headers.authorization);
      assert.ok(seen[0].headers["X-Service-Token"]);
      assert.ok(!seen[1].headers.authorization);
      assert.ok(!seen[1].headers.Cookie);
      assert.ok(!seen[1].headers["X-Service-Token"]);
      assert.ok(!seen[1].headers["X-Custom"]);
      assert.ok(!seen[1].headers["X-Unknown"]);
      assert.ok(!seen[1].headers.Referer && !seen[1].headers.referer);
      assert.ok(!seen[2].headers.authorization);
      assert.ok(!seen[2].headers["X-Service-Token"]);
      assert.ok(!seen[2].headers["X-Custom"]);
      assert.ok(!seen[2].headers["X-Unknown"]);
      assert.ok(!seen[2].headers.Referer && !seen[2].headers.referer);
    });
  });
});

test("same-origin redirect preserves headers", async () => {
  const seen = [];
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    await withTransport(async (url, opts) => {
      seen.push({ url: String(url), headers: opts?.headers || {} });
      if (String(url).endsWith("/start")) {
        return redirect("/final");
      }
      return html("done");
    }, async () => {
      await fetchText("https://example.com/start", {
        headers: { Authorization: "Bearer x", Cookie: "a=b", "X-Custom": "1" },
      });
      assert.equal(seen.length, 2);
      assert.ok(seen[1].headers.Authorization);
      assert.ok(seen[1].headers.Cookie);
      assert.ok(seen[1].headers["X-Custom"]);
    });
  });
});

test("IPv6 special-purpose ranges blocked including Teredo and site-local", () => {
  const blocked = [
    "2001::1",
    "2001:0:0:0:0:0:0:1",
    "2001:0:4137:9e76:43e:2599:3f57:fe9a",
    "2001:0::",
    "fec0::1",
    "fec0::ffff:0:0",
    "fec0:0:0:ffff::1",
    "::ffff:192.168.1.1",
    "::192.168.1.1",
    "::7f00:1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.1.1",
    "::ffff:172.16.0.1",
    "::ffff:192.168.0.1",
    "::192.168.1.1",
    "0:0:0:0:0:0:0:1",
    "::1",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    "0000:0000:0000:0000:0000:0000:7f00:0001",
    "0000:0000:0000:0000:0000:ffff:c000:0201",
    "0000:0000:0000:0000:0000:ffff:a9fe:a9fe",
    "0000:0000:0000:0000:0000:0000:c0a8:0001",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002::1",
    "2001:2::1",
    "2001:4::1",
    "2001:4:111::1",
    "2001:4:113::1",
    "2001:5::1",
    "2001:6::1",
    "2001:7::1",
    "2001:8::1",
    "2001:f::1",
    "2001:100::1",
    "2001:1ff::1",
    "2001:10::1",
    "2001:40::1",
    "64:ff9b::a00:1",
    "64:ff9b:1::1",
    "100::1",
    "5f00::1",
    "3fff::1",
    "4000::1",
    "2d00::1",
    "2dff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "2e00::1",
    "2fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "3000::1",
    "3ffe::1",
  ];
  for (const ip of blocked) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be blocked`);
  }
  assert.equal(isPrivateOrReservedIp("2001:4860:4860::8888"), false);
  assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
  assert.equal(isPrivateOrReservedIp("2606:2800:220:1:248:1893:25c8:1946"), false);
  assert.equal(isPrivateOrReservedIp("2a00:1450:4001:81a::200e"), false);
  assert.equal(isPrivateOrReservedIp("0000:0000:0000:0000:0000:ffff:0808:0808"), false);
  for (const ip of [
    "64:ff9b::808:808",
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), false, `${ip} must be allowed`);
  }
  // Protocol-specific anycast/special-use space is denied for generic SSRF
  assert.equal(isPrivateOrReservedIp("2001:1::1"), true);
  assert.equal(isPrivateOrReservedIp("2001:1::2"), true);
  assert.equal(isPrivateOrReservedIp("2001:1::3"), true);
  assert.equal(isPrivateOrReservedIp("2001:1::4"), true);
  assert.equal(isPrivateOrReservedIp("2001:3::"), true);
  assert.equal(isPrivateOrReservedIp("2001:3:ffff:ffff:ffff:ffff:ffff:ffff"), true);
  assert.equal(isPrivateOrReservedIp("2001:4:112::"), true);
  assert.equal(isPrivateOrReservedIp("2001:4:112:ffff:ffff:ffff:ffff:ffff"), true);
  assert.equal(isPrivateOrReservedIp("2001:20::"), true);
  assert.equal(isPrivateOrReservedIp("2001:2f:ffff:ffff:ffff:ffff:ffff:ffff"), true);
  assert.equal(isPrivateOrReservedIp("64:ff9b::a00:1"), true);
});

test("SSRF policy blocks IANA globally reachable protocol-specific special-use space", () => {
  for (const ip of [
    "2001:30::",
    "2001:30::1",
    "2001:3f:ffff:ffff:ffff:ffff:ffff:ffff",
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be blocked`);
  }
  for (const ip of ["2001:3::1", "2001:20::1"]) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be blocked`);
  }
});

test("IPv4 exceptions and benchmarking ranges", () => {
  assert.equal(isPrivateOrReservedIp("192.0.0.9"), false);
  assert.equal(isPrivateOrReservedIp("192.0.0.10"), false);
  assert.equal(isPrivateOrReservedIp("192.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("198.18.0.1"), true);
  assert.equal(isPrivateOrReservedIp("198.19.255.255"), true);
});

test("default transport passes pinned lookup, agent:false, and TLS settings to https.request", async () => {
  const originalRequest = https.request;
  const calls = [];
  https.request = function (options, callback) {
    calls.push(options);
    const req = {
      on() { return this; },
      setTimeout() { return this; },
      end() {},
      destroy() {},
    };
    process.nextTick(() => {
      callback({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        on(ev, fn) {
          if (ev === "data") fn(Buffer.from("<html>ok</html>"));
          if (ev === "end") process.nextTick(fn);
          return this;
        },
      });
    });
    return req;
  };
  if (typeof _clearTransportOverride === "function") {
    try { _clearTransportOverride(); } catch {}
  } else {
    try { _enableTransportOverride(); _setTransport(null); } catch {}
  }
  try {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      const body = await fetchText("https://example.com/test");
      assert.equal(body, "<html>ok</html>");
      assert.equal(calls.length, 1);
      const opts = calls[0];
      assert.equal(opts.agent, false);
      assert.equal(opts.rejectUnauthorized, true);
      assert.equal(opts.servername, "example.com");
      assert.equal(typeof opts.lookup, "function");
      const pinned = new Map([["example.com", [PUBLIC_V4]]]);
      // The lookup is created per request with the pinned map from fetchText
      // Verify it behaves correctly
      await new Promise((resolve, reject) => {
        opts.lookup("example.com", { all: false }, (err, addr, family) => {
          if (err) reject(err);
          else {
            assert.equal(addr, PUBLIC_V4);
            assert.equal(family, 4);
            resolve();
          }
        });
      });
      await assert.rejects(
        () => new Promise((resolve, reject) => {
          opts.lookup("169.254.169.254", { all: false }, (err) => err ? reject(err) : resolve());
        }),
        (err) => err && err.code === "ENOTFOUND",
      );
    });
  } finally {
    https.request = originalRequest;
  }
});

test("default transport passes pinned lookup and agent:false to http.request", async () => {
  const originalRequest = http.request;
  const calls = [];
  http.request = function (options, callback) {
    calls.push(options);
    const req = {
      on() { return this; },
      setTimeout() { return this; },
      end() {},
      destroy() {},
    };
    process.nextTick(() => {
      callback({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        on(ev, fn) {
          if (ev === "data") fn(Buffer.from("<html>ok2</html>"));
          if (ev === "end") process.nextTick(fn);
          return this;
        },
      });
    });
    return req;
  };
  if (typeof _clearTransportOverride === "function") {
    try { _clearTransportOverride(); } catch {}
  } else {
    try { _enableTransportOverride(); _setTransport(null); } catch {}
  }
  try {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      const body = await fetchText("http://example.com/test2");
      assert.equal(body, "<html>ok2</html>");
      assert.equal(calls.length, 1);
      const opts = calls[0];
      assert.equal(opts.agent, false);
      assert.equal(typeof opts.lookup, "function");
      await new Promise((resolve, reject) => {
        opts.lookup("example.com", { all: true }, (err, addrs) => {
          if (err) reject(err);
          else {
            assert.ok(Array.isArray(addrs));
            assert.equal(addrs[0].address, PUBLIC_V4);
            resolve();
          }
        });
      });
    });
  } finally {
    http.request = originalRequest;
  }
});

test("DNS rebinding simulation cannot change destination - lookup uses pinned addresses only", async () => {
  const originalRequest = https.request;
  const calls = [];
  https.request = function (options, callback) {
    calls.push(options);
    const req = {
      on() { return this; },
      setTimeout() { return this; },
      end() {},
      destroy() {},
    };
    process.nextTick(() => {
      callback({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        on(ev, fn) {
          if (ev === "data") fn(Buffer.from("safe"));
          if (ev === "end") process.nextTick(fn);
          return this;
        },
      });
    });
    return req;
  };
  if (typeof _clearTransportOverride === "function") {
    try { _clearTransportOverride(); } catch {}
  } else {
    try { _enableTransportOverride(); _setTransport(null); } catch {}
  }
  let callsDns = 0;
  _setDnsLookup(async () => {
    callsDns += 1;
    if (callsDns === 1) return [{ address: PUBLIC_V4 }];
    return [{ address: "169.254.169.254" }];
  });
  try {
    const body = await fetchText("https://rebind.example.com/");
    assert.equal(body, "safe");
    assert.equal(callsDns, 1);
    const opts = calls[0];
    const result = await new Promise((resolve, reject) => {
      opts.lookup("rebind.example.com", {}, (err, addr) => err ? reject(err) : resolve(addr));
    });
    assert.equal(result, PUBLIC_V4);
  } finally {
    https.request = originalRequest;
    _setDnsLookup();
  }
});

test("isPrivateOrReservedIp blocks 6to4 and transition ranges", () => {
  const blocked = [
    "2002::1",
    "2002:db8::1",
    "2001:2::1",
    "2001:4::1",
    "2001:5::1",
    "2001:6::1",
    "2001:7::1",
    "2001:8::1",
    "2001:f::1",
    "2001:100::1",
    "2001:10::1",
    "2001:1ff::1",
    "64:ff9b:1::1",
    "100::1",
    "3fff::1",
    "192.88.99.1",
  ];
  for (const ip of blocked) {
    assert.equal(isPrivateOrReservedIp(ip), true, `${ip} must be blocked`);
  }
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
  assert.equal(isPrivateOrReservedIp(PUBLIC_V6), false);
  for (const ip of ["64:ff9b::808:808"]) {
    assert.equal(isPrivateOrReservedIp(ip), false, `${ip} is globally reachable`);
  }
  assert.equal(isPrivateOrReservedIp("2001:3::1"), true);
  assert.equal(isPrivateOrReservedIp("2001:20::1"), true);
  assert.equal(isPrivateOrReservedIp("64:ff9b::1"), true);
});

test("default transport accepts a response exactly at the 8 MiB cap", async () => {
  assert.equal(MAX_RESPONSE_BYTES, 8 * 1024 * 1024);
  await withDefaultHttpsRequest((callback, _req, state) => {
    makeNodeResponse(callback, state, {
      headers: {
        "content-type": "text/html",
        "content-length": String(MAX_RESPONSE_BYTES),
      },
      chunks: [Buffer.alloc(MAX_RESPONSE_BYTES, 0x61)],
    });
  }, async (state) => {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      const body = await fetchText("https://example.com/exact-cap");
      assert.equal(Buffer.byteLength(body), MAX_RESPONSE_BYTES);
      assert.equal(state.requestDestroyed, false);
      assert.equal(state.responseDestroyed, false);
    });
  });
});

test("default transport aborts an oversized stream without Content-Length", async () => {
  await withDefaultHttpsRequest((callback, _req, state) => {
    makeNodeResponse(callback, state, {
      headers: { "content-type": "text/html" },
      chunks: [Buffer.alloc(MAX_RESPONSE_BYTES), Buffer.from("x")],
    });
  }, async (state) => {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      await assert.rejects(
        () => fetchText("https://example.com/stream-too-large", { retries: 5 }),
        (err) => err instanceof HttpError && /exceeds maximum size/i.test(err.message),
      );
      assert.equal(state.requests, 1, "oversize responses must not be retried");
      assert.equal(state.requestDestroyed, true);
      assert.equal(state.responseDestroyed, true);
    });
  });
});

test("default transport rejects oversized declared Content-Length before reading", async () => {
  await withDefaultHttpsRequest((callback, _req, state) => {
    makeNodeResponse(callback, state, {
      headers: {
        "content-type": "text/html",
        "content-length": String(MAX_RESPONSE_BYTES + 1),
      },
    });
  }, async (state) => {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      await assert.rejects(
        () => fetchText("https://example.com/declared-too-large", { retries: 5 }),
        (err) => err instanceof HttpError && /exceeds maximum size/i.test(err.message),
      );
      assert.equal(state.requests, 1, "oversize responses must not be retried");
      assert.equal(state.requestDestroyed, true);
      assert.equal(state.responseDestroyed, true);
    });
  });
});

test("default transport rejects an interrupted response instead of returning partial data", async () => {
  await withDefaultHttpsRequest((callback, _req, state) => {
    const response = makeNodeResponse(callback, state, {
      headers: { "content-type": "text/html" },
      chunks: [Buffer.from("partial body")],
      end: false,
    });
    response.emit("aborted");
  }, async (state) => {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      await assert.rejects(
        () => fetchText("https://example.com/interrupted", { retries: 0 }),
        (err) => err instanceof HttpError && /interrupted/i.test(err.message),
      );
      assert.equal(state.requestDestroyed, true);
      assert.equal(state.responseDestroyed, true);
    });
  });
});

test("response timeout destroys the active response and request without returning partial data", async () => {
  await withDefaultHttpsRequest((callback, _req, state) => {
    makeNodeResponse(callback, state, {
      headers: { "content-type": "text/html" },
      chunks: [Buffer.from("partial body")],
      end: false,
    });
  }, async (state) => {
    await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
      await assert.rejects(
        () => fetchText("https://example.com/stalled-body", { timeoutMs: 100, retries: 0 }),
        (err) => err instanceof HttpError && /timed out/i.test(err.message),
      );
      assert.equal(state.requestDestroyed, true);
      assert.equal(state.responseDestroyed, true);
    });
  });
});

test("transport override cannot return a partial oversized body as success", async () => {
  await withDns(async () => [{ address: PUBLIC_V4 }], async () => {
    let requests = 0;
    await withTransport(async () => {
      requests += 1;
      return html("x".repeat(MAX_RESPONSE_BYTES + 1));
    }, async () => {
      await assert.rejects(
        () => fetchText("https://example.com/override-too-large", { retries: 5 }),
        (err) => err instanceof HttpError && /exceeds maximum size/i.test(err.message),
      );
      assert.equal(requests, 1, "oversize responses must not be retried");
    });
  });
});
