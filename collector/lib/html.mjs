// ---------------------------------------------------------------------------
// Collector - minimal HTML text helpers.
//
// The project has no server-side HTML parser and we are deliberately not
// adding a dependency for this (see collector/README.md). These helpers are
// small, tolerant and regex-based; they are only ever applied to the specific
// fragments each source adapter asks for.
//
// Every adapter also checks a structural *marker* before parsing, so if the
// site markup changes shape the collector reports a clear parse error instead
// of silently returning zero notices.
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "...", mdash: "—", ndash: "–",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', middot: "·",
  ndash2: "–", copy: "©", reg: "®", trade: "™", pound: "£", euro: "€",
};

/** Decode the HTML entities that realistically occur in notice titles. */
export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full;
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? full : named;
  });
}

/** Remove HTML comments - JNTUH rows contain commented-out table cells. */
export function removeComments(html) {
  return String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** Drop tags and collapse whitespace, leaving the visible text of a fragment. */
export function textOf(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match `pattern` (a global regex with at least one capture group) against
 * `html` and return every match's capture groups as an array of arrays.
 * Returns `[]` when there is no match - never throws.
 */
export function matchAll(html, pattern) {
  const out = [];
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let match;
  while ((match = regex.exec(String(html ?? ""))) !== null) {
    out.push(match.slice(1));
    if (match.index === regex.lastIndex) regex.lastIndex += 1; // guard against zero-length matches
  }
  return out;
}

/**
 * Like `matchAll`, but keeps each match's offset in the source - needed when
 * the parser has to know *where* a block starts (e.g. which tab pane an item
 * belongs to). Returns `[{ index, raw, groups }]`.
 */
export function matchIndexed(html, pattern) {
  const text = String(html ?? "");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const out = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    out.push({ index: match.index, raw: match[0], groups: match.slice(1) });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return out;
}
