// ---------------------------------------------------------------------------
// Collector - error types.
//
// Each adapter reports failures explicitly so `index.mjs` can print an error
// per source and exit non-zero. No error is swallowed or turned into an empty
// (but "successful") result.
// ---------------------------------------------------------------------------

/** The page was fetched, but it no longer matches the structure we expect. */
export class ParseError extends Error {
  constructor(message, { sourceId, marker, url } = {}) {
    super(message);
    this.name = "ParseError";
    this.sourceId = sourceId ?? "";
    this.marker = marker ?? "";
    this.url = url ?? "";
  }
}

/** A source-level failure (fetch, parse, or unexpected empty result). */
export class SourceError extends Error {
  constructor(message, { sourceId, phase, cause } = {}) {
    super(message);
    this.name = "SourceError";
    this.sourceId = sourceId ?? "";
    this.phase = phase ?? "unknown"; // "fetch" | "parse"
    if (cause) this.cause = cause;
  }
}

/** True for anything that should be reported as a per-source failure. */
export function isSourceFailure(error) {
  return (
    error instanceof SourceError ||
    error instanceof ParseError ||
    (error && typeof error === "object" && error.name === "HttpError")
  );
}
