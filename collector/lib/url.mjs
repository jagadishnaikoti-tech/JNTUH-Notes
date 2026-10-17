// ---------------------------------------------------------------------------
// Collector - URL normalisation helpers (no dependencies).
//
// These helpers are used both for *display* (the dry-run report) and as the
// basis of duplicate detection. Two rules matter:
//
//   1. A URL must be usable - i.e. it has to actually resolve when someone
//      clicks it from the Alert Radar.
//   2. The *same* notice must produce the *same* canonical URL on every run,
//      otherwise we would create a duplicate alert each time.
//
// The exam portal embeds a servlet session token in its download links
// (`/Portal/common/downloadFile;jsessionid=ABC?fileName=...`). Those tokens
// change on every visit, so they are stripped - otherwise every run would look
// like a brand new notice.
// ---------------------------------------------------------------------------

/** `;jsessionid=...` path token used by the JNTUH exam portal. */
const JSESSIONID = /;jsessionid=[^/?#]*/gi;

/**
 * Remove servlet session tokens such as `;jsessionid=DEADBEEF` from a URL
 * string. Returns the input unchanged when there is nothing to remove.
 */
export function stripSessionTokens(value) {
  return String(value ?? "").replace(JSESSIONID, "");
}

/**
 * Resolve `href` against `baseUrl` and return an absolute http(s) URL.
 * Session tokens are stripped first. Returns `null` when the input is empty or
 * cannot be parsed (the caller decides whether that is fatal).
 */
export function absolutizeUrl(href, baseUrl) {
  const raw = stripSessionTokens(String(href ?? "").trim());
  if (!raw) return null;
  try {
    return new URL(raw, String(baseUrl)).href;
  } catch {
    return null;
  }
}

/**
 * Canonical form of a URL, used for duplicate detection.
 *
 * Normalises: protocol + host casing, session tokens, hash, embedded
 * credentials, repeated slashes, trailing slashes, and query ordering/encoding
 * (`+` and `%20` both become a plain space in the canonical form).
 *
 * Returns `null` for anything that is not an absolute http(s) URL, so that
 * `mailto:`/`javascript:`/relative-garbage can never become a dedup key.
 */
export function canonicalizeUrl(href, baseUrl) {
  const absolute = absolutizeUrl(href, baseUrl);
  if (!absolute) return null;

  let url;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // `//pages/...` appears in a few JNTUH links; collapse repeated slashes so
  // the two spellings dedupe to one key.
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Sort query parameters so ordering cannot split one notice into two, and
  // let URLSearchParams unify `%20` / `+` encoding.
  const entries = [...url.searchParams.entries()].sort((a, b) =>
    a[0] === b[0]
      ? String(a[1]).localeCompare(String(b[1]))
      : String(a[0]).localeCompare(String(b[0])),
  );
  if (entries.length) {
    url.search = "";
    for (const [key, value] of entries) url.searchParams.append(key, value);
  } else {
    url.search = "";
  }

  return url.href;
}

/** File extensions we treat as an attachment/document rather than a web page. */
const FILE_EXTENSIONS = new Set([
  "pdf", "zip", "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "gif", "webp", "txt", "csv", "odt", "ods",
]);

/** Query parameter names (lower-cased) that carry a file name. */
const FILE_QUERY_PARAMS = new Set(["filename", "file", "filepath", "path", "document", "doc", "url"]);

function hasFileExtension(value) {
  const clean = String(value ?? "").split("#")[0].split("?")[0];
  const lastSegment = clean.split("/").pop();
  if (!lastSegment || !lastSegment.includes(".")) return false;
  const ext = lastSegment.split(".").pop().toLowerCase();
  return FILE_EXTENSIONS.has(ext);
}

/**
 * True when the URL points at a downloadable file rather than an HTML page.
 *
 * The main site puts the file name in the path
 * (`/uploads/notifications/notice.pdf`), but the exam portal puts it in the
 * query string (`/Portal/common/downloadFile?fileName=notice.pdf`) while the
 * path itself has no extension at all - so both places are inspected.
 */
export function isFileUrl(canonicalUrl) {
  if (!canonicalUrl) return false;
  try {
    const url = new URL(canonicalUrl);
    if (hasFileExtension(url.pathname)) return true;
    // Parameter names are matched case-insensitively: the portal spells it
    // `fileName`, not `filename`, and URLSearchParams.get() is case-sensitive.
    for (const [key, value] of url.searchParams.entries()) {
      if (FILE_QUERY_PARAMS.has(key.toLowerCase()) && value && hasFileExtension(value)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
