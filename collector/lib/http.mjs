// ---------------------------------------------------------------------------
// Collector - polite HTTP client (no dependencies).
//
// Rules enforced here:
//   * only http(s) GET requests to public pages;
//   * an explicit timeout on every request, so a hung host cannot stall CI;
//   * a small, bounded retry with backoff for transient failures only;
//   * a minimum gap between requests (rate limiting) and an honest User-Agent;
//   * **no** login, cookies, CAPTCHA solving, header spoofing to look like a
//     browser, or any other access-control bypass. If a page starts requiring
//     authentication we surface an error and stop - we do not work around it.
// ---------------------------------------------------------------------------

export const DEFAULT_USER_AGENT =
  "JNTUHNotes-AlertCollector/1.0 (+https://jntuh.ac.in; read-only; contact via project README)";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_GAP_MS = 1_500; // polite delay between requests

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

/**
 * Sequential rate limiter: `await limiter()` before every outgoing request.
 * Ensures a minimum gap between requests regardless of how the caller is wired.
 */
export function createRateLimiter(gapMs = DEFAULT_GAP_MS) {
  let nextAt = 0;
  return async function waitTurn() {
    const now = Date.now();
    const wait = nextAt - now;
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + Math.max(0, gapMs);
  };
}

/**
 * Fetch a public URL and return its text body.
 *
 * @param {string} url
 * @param {{
 *   timeoutMs?: number, retries?: number, gap?: () => Promise<void>,
 *   headers?: Record<string,string>, accept?: string
 * }} [options]
 * @returns {Promise<string>}
 * @throws {HttpError}
 */
export async function fetchText(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    gap,
    headers = {},
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  } = options;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(`Not a valid URL: ${url}`, { url });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(`Refusing non-http(s) URL: ${url}`, { url });
  }

  const requestHeaders = {
    "user-agent": DEFAULT_USER_AGENT,
    accept,
    "accept-language": "en-IN,en;q=0.9",
    ...headers,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (gap) await gap();

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: requestHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
      lastError = new HttpError(
        timedOut
          ? `Request timed out after ${timeoutMs}ms: ${url}`
          : `Request failed: ${url} (${cause?.code || cause?.name || "error"})`,
        { url, cause },
      );
      if (timedOut) break; // a timeout on a polite crawl: do not hammer it
      if (attempt < retries) { await sleep(backoffMs(attempt)); continue; }
      throw lastError;
    }

    if (!response.ok) {
      const status = response.status;
      // Auth and bot-protection responses are terminal: never retry/bypass them.
      if (status === 401 || status === 403 || status === 407 || status === 429 || status === 511) {
        throw new HttpError(
          `Access denied by the source (HTTP ${status}). Not attempting to bypass it: ${url}`,
          { url, status },
        );
      }
      if (status >= 500 && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new HttpError(`HTTP ${status} fetching ${url}`, { url, status });
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/text\/|xml|json/.test(contentType)) {
      throw new HttpError(
        `Unexpected content type "${contentType}" from ${url}`,
        { url, status: response.status },
      );
    }

    return await response.text();
  }

  throw lastError ?? new HttpError(`Failed to fetch ${url}`, { url });
}

function backoffMs(attempt) {
  return 500 * 2 ** attempt;
}

/** True for text that looks like a bot-check / login wall rather than a listing. */
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
