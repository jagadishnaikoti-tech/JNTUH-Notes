import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  INGEST_ID_LENGTH,
  fingerprintOfTokens,
  ingestItemId,
  isIngestItemId,
  structureFingerprint,
  structureTokens,
} from "../lib/ingestIds.mjs";

const URL_A = "https://jntuh.ac.in/uploads/notifications/a.pdf";
const URL_B = "https://jntuh.ac.in/uploads/notifications/b.pdf";

test("ingestItemId is repeatable and is 32 lower-case hex characters", () => {
  const first = ingestItemId("notifications", URL_A);
  assert.equal(first, ingestItemId("notifications", URL_A));
  assert.equal(first, ingestItemId("notifications", URL_A));
  assert.equal(first.length, INGEST_ID_LENGTH);
  assert.match(first, /^[0-9a-f]{32}$/);
});

test("ingestItemId separates sources and URLs", () => {
  assert.notEqual(
    ingestItemId("notifications", URL_A),
    ingestItemId("exams", URL_A),
    "the same URL under a different source is a different item",
  );
  assert.notEqual(
    ingestItemId("notifications", URL_A),
    ingestItemId("notifications", URL_B),
    "a different URL is a different item",
  );
});

test("ingestItemId refuses notices with no usable identity", () => {
  assert.equal(ingestItemId("notifications", null), null);
  assert.equal(ingestItemId("notifications", ""), null);
  assert.equal(ingestItemId("notifications", "   "), null);
  assert.equal(ingestItemId("", URL_A), null);
  assert.equal(ingestItemId(null, URL_A), null);
  assert.equal(ingestItemId(undefined, undefined), null);
});

test("the separator makes the id boundary-proof", () => {
  // Without a separator these two pairs would concatenate identically.
  assert.notEqual(ingestItemId("ab", "c"), ingestItemId("a", "bc"));
  assert.notEqual(ingestItemId("notifications", "https://x/a"), ingestItemId("notificationsh", "ttps://x/a"));
});

test("separator collision protection: a NUL-bearing input is refused", () => {
  // Composing the two distinct pairs below with the separator flattens both to
  // the single string "a\u0000b\u0000c", i.e. the separator alone is not enough
  // when an input can itself contain the separator.
  const withSeparator = (source, url) => `${source}\u0000${url}`;
  assert.equal(withSeparator("a", "b\u0000c"), withSeparator("a\u0000b", "c"));

  // So any input carrying a NUL byte is refused outright: two distinct pairs can
  // never be made to mint the same id.
  assert.equal(ingestItemId("a", "b\u0000c"), null);
  assert.equal(ingestItemId("a\u0000b", "c"), null);
});

test("isIngestItemId accepts only minted ids", () => {
  assert.equal(isIngestItemId(ingestItemId("notifications", URL_A)), true);
  assert.equal(isIngestItemId("A".repeat(32)), false, "upper-case is not our alphabet");
  assert.equal(isIngestItemId("a".repeat(31)), false, "too short");
  assert.equal(isIngestItemId("a".repeat(33)), false, "too long");
  assert.equal(isIngestItemId("g".repeat(32)), false, "not hex");
  assert.equal(isIngestItemId(null), false);
  assert.equal(isIngestItemId(123), false);
});

test("structureTokens collects sorted tag/class/id tokens and drops comments", () => {
  const html = `
    <table class="grideheader">
      <tr class="griderow1 griderow2">
        <td><a href="a.pdf">Fee notification</a></td>
      </tr>
      <!--<td class="deadcell">commented out</td>-->
      <td class=plaincell data-id="7">x</td>
      <div id="pager"></div>
    </table>`;
  const tokens = structureTokens(html);

  assert.deepEqual(tokens, [...tokens].sort(), "tokens must be sorted");
  assert.deepEqual(tokens, [...new Set(tokens)], "tokens must be unique");
  assert.ok(tokens.includes("class:grideheader"));
  assert.ok(tokens.includes("class:griderow1"));
  assert.ok(tokens.includes("class:griderow2"));
  assert.ok(tokens.includes("class:plaincell"), "unquoted attributes must be read");
  assert.ok(tokens.includes("id:pager"));
  assert.ok(tokens.includes("tag:table"));
  assert.ok(tokens.includes("tag:tr"));
  assert.ok(!tokens.includes("class:deadcell"), "commented-out markup must be ignored");
  assert.ok(!tokens.includes("id:7"), "a data-id= attribute is not the id attribute");
});

test("fingerprintOfTokens is order- and duplicate-insensitive", () => {
  const a = fingerprintOfTokens(["tag:tr", "class:x", "class:y"]);
  const b = fingerprintOfTokens(["class:y", "tag:tr", "class:y", "class:x"]);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("structureFingerprint ignores text content and cosmetic whitespace", () => {
  const october = `<table class="list"><tr class="r1"><td>15 Oct 2026</td></tr></table>`;
  const november = `<table   class="list"><tr class="r1"><td>16 Nov 2026</td></tr></table>`;
  const reformatted = `<table\n\tclass="list">\n  <tr class="r1"><td>completely different words</td></tr>\n</table>`;

  assert.equal(
    structureFingerprint(october),
    structureFingerprint(november),
    "a new notice must not change the structure fingerprint",
  );
  assert.equal(structureFingerprint(october), structureFingerprint(reformatted));
});

test("structureFingerprint changes when the markup changes shape", () => {
  const before = `<table class="list"><tr class="r1"><td>x</td></tr></table>`;
  const after = `<table class="list reworked"><tr class="row"><td>x</td></tr></table>`;
  assert.notEqual(structureFingerprint(before), structureFingerprint(after));
});

test("structureFingerprint is stable for empty input", () => {
  assert.equal(structureFingerprint(""), structureFingerprint(null));
  assert.match(structureFingerprint(""), /^[0-9a-f]{32}$/);
});
