# JNTUH Alert Radar collector

A small, dependency-free Node script that reads two public JNTUH pages and
prints the notices it finds. It is the ingestion half of the **Alert Radar**
feature on the site.

> **Status: dry run by default, staging writes opt-in.** With no flags the
> collector only *reads* and *reports* — it never initialises the Firebase Admin
> SDK. Passing `--write` (with `--project`) lets it *stage* notices in
> admin-only Firestore collections for human review. It can never verify,
> publish or modify an alert. See [Dry-run mode](#dry-run-mode),
> [Write mode (staging)](#write-mode-staging) and
> [Why automatic publication is disabled](#why-automatic-publication-is-disabled).

---

## Running it

Node 18+ (developed and verified on Node 24). There are **no npm dependencies**
to install for the collector — it uses only Node built-ins.

```bash
# Dry run against the live public pages (the default; read-only)
npm run collector

# Same thing, explicitly
node collector/index.mjs

# Only one source, capped output
node collector/index.mjs --source notifications --limit 10

# Machine-readable
node collector/index.mjs --json

# Offline, from saved HTML (used by the tests)
node collector/index.mjs --offline collector/tests/fixtures

# Help
node collector/index.mjs --help
```

### Tests

```bash
npm run test:collector
```

The test runner matches the glob `collector/tests/*.test.mjs`, so Node 22+ is
expected for the test command (Node 18/20 require you to list the files
yourself). **The collector itself runs on Node 18+.**

---

## Dry-run mode (the default)

With no flags the collector only reads and reports. Every dry run:

1. issues a plain HTTP `GET` to each source's public listing page;
2. parses the HTML into "notices";
3. deduplicates them by canonical URL;
4. builds a *draft* alert in memory purely to validate field conventions;
5. prints a report.

and then stops. In particular a dry run:

- **never** imports or initialises the Firebase Admin SDK (the Admin SDK is
  loaded only through a dynamic `import()` inside the `--write` branch);
- **never** writes to Firestore, to disk, or to any other store;
- **never** creates, modifies, or deletes an alert;
- **never** publishes anything.

This is enforced mechanically, not just by convention — `collector/tests/safety.test.mjs`
and `collector/tests/guard.test.mjs` assert that exactly one module
(`collector/lib/firestoreAdmin.mjs`) imports the Firebase Admin SDK, that no
other implementation module references a Firestore write API, and that the CLI
entry point contains no Firestore/Admin initialisation and no file-writing API.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | every requested source was fetched and parsed |
| `1`  | at least one source failed to fetch or parse (the error is printed per source and again on stderr) |
| `2`  | bad command line usage (unknown source id, non-numeric `--limit`, …) |

Failures are never converted into an empty-but-"successful" result. Each source
gets its own status line, and a parse that matches the page's shape but yields
zero notices is treated as a markup change and reported as an error.

### Options

| Option | Default | Effect |
| ------ | ------- | ------ |
| `--source <id>` | all | Run only one source. Repeatable. Ids: `notifications`, `exams`. |
| `--limit <n>` | `0` (all) | Print at most `n` notices per source. |
| `--timeout <ms>` | `15000` | Per-request timeout. |
| `--gap <ms>` | `1500` | Minimum delay between HTTP requests (politeness). |
| `--panes <a,b>` | `notification` | Exam-portal tab panes to collect. |
| `--baseline <file>` | — | Read previously seen keys from a JSON file for cross-run dedup. **Read-only**: the file is never created or updated. |
| `--offline <dir>` | — | Read `<dir>/<sourceId>.html` instead of the network. |
| `--json` | off | Emit JSON instead of the text report. |

---

## Write mode (staging)

With `--write` the collector stages what it found in Firestore instead of just
printing it. It writes **only** to admin-only staging collections:

| Collection | One document per | Written by |
| ---------- | ---------------- | ---------- |
| `ingestItems` | staged notice (no `status`, no alert fields) | collector |
| `ingestRuns` | collector run ("what happened?") | collector |
| `ingestSourceHealth` | official source (last attempt / last success) | collector |

Write mode never touches the public `alerts` collection, and every staged notice
is a plain record awaiting review — the collector can produce neither a verified
nor a published alert.

### Write-mode options

| Option | Default | Effect |
| ------ | ------- | ------ |
| `--write` | off | Enable staging writes. Requires `--project`. |
| `--project <id>` | — | Must equal `jntuh-notes-6ef74`; any other id is refused (fail closed). |
| `--emulator` | off | Write to the local Firestore emulator. Requires `FIRESTORE_EMULATOR_HOST`; cannot be combined with `--allow-production`. |
| `--allow-production` | off | Required for a real (non-emulator) write. Refused if `FIRESTORE_EMULATOR_HOST` is set. |
| `--max-items <n>` | `0` (all) | Cap how many new staged notices are created in one run. |

### Guardrails

- A bare invocation is still a dry run — `--write` defaults to `false`.
- `--allow-production` and `--emulator` are usage errors without `--write`.
- Credentials come from **Application Default Credentials**
  (`GOOGLE_APPLICATION_CREDENTIALS`, or an attached/Workload Identity service
  account). No key is stored in the repository, and the collector keeps no
  secrets in code.
- The store's allowlist accepts only the three staging collection names above.

```bash
# Stage into the local emulator (safe, no production data)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node collector/index.mjs --write --emulator --project jntuh-notes-6ef74

# Stage into production (deliberate double opt-in)
node collector/index.mjs --write --allow-production --project jntuh-notes-6ef74
```

### The admin review workflow is separate

Staging and review are two distinct systems:

- the **collector** writes raw staged notices into `ingestItems`;
- the **admin review workflow** is the web app page at `/admin/ingest`
  (`src/lib/ingest.js` + `src/pages/admin/AdminIngest.jsx`). There an
  administrator filters the queue by review state and source, opens the original
  source URL, ignores a notice, returns an ignored notice to review, or promotes
  a reviewed notice into a private alert **draft** in one transaction.

Neither half can publish: promotion creates a draft, and verification/publishing
stay a manual administrator action on the Alert Radar page.

---

## Supported sources

Both sources are public HTML pages. No login, no API key, no session.

### `notifications` — <https://jntuh.ac.in/notifications>

A server-rendered HTML table (`S.No | Date | Title`) covering notifications from
DAP, DUEX, admissions and others.

- Header row is `<tr class="grideheader">`, data rows are `<tr class="griderowN">`.
- Date format: `15 Oct 2026`.
- The Title cell holds one `<a href>` pointing either at a file
  (`/uploads/notifications/*.pdf|zip|jpg|doc…`) or at an internal
  `jntuh.ac.in/content/...` notice page, or at a subdomain such as
  `doa.jntuh.ac.in` / `doaphd.jntuh.ac.in`.
- Rows may contain commented-out cells (`<!--<td>-</td>-->`) and a `<img>` "new"
  marker after the link; both are handled.
- Category defaults to `general`. The listing does not expose the directorate
  per row, so a more specific category **cannot** be derived without inventing
  one — it needs an admin decision during review.
- Latest 100 rows are on the page (~500 archived); the older ones are only
  reachable through the site's own AJAX paging, which is not used here yet.

### `exams` — <https://exams1.jntuh.ac.in/>

The University Examination Portal. `/` meta-refreshes to
`/Portal/common/load`, which is fetched directly.

Three Bootstrap tab panes:

| Pane | Items | Link path | Category |
| ---- | ----- | --------- | -------- |
| `notification` | 40 | `/Portal/common/downloadFile?fileName=…pdf` | `exams` |
| `timetable` | 20 | `/Portal/common/downloadTimetable?fileName=…docx` | `timetable` |
| `others` | 20 | `/Portal/common/downloadOther?fileName=…` plus links to results/studentservices/epay | `general` |

- Date format: `16-10-2026` (DD-MM-YYYY).
- Links carry a servlet session token — `…/downloadFile;jsessionid=ABC123?fileName=…` —
  which changes on every visit and is stripped during canonicalisation,
  otherwise every run would look like a batch of brand-new notices. The token is
  not required: the endpoint serves the file without it (verified).
- **Only the `notification` pane is collected by default.** Timetables and
  "Others" are opt-in via `--panes` so that exam timetables and external service
  links are not silently mixed into the alert feed.

---

## Known limitations

- **Scanned PDFs are not read.** The collector records the document URL; it does
  not download or OCR it. At least some exam-portal PDFs are scans
  (`Producer (cnijscan)`), so nothing inside them is available as structured
  data. Extracting content from them would need an OCR step and is deliberately
  out of scope.
- **No summaries are produced.** `firestore.rules` requires `summary` to be at
  least one character *for a write*, but fabricating a summary from a title would
  present invented text as an official notice. Drafts are returned with
  `summary: ""` and a `summary-required` review reason so an admin writes it.
- **No deadlines are inferred.** `deadlineAt` is always `null`. A deadline is
  only ever set by a human reading the notice.
- **Attachments beyond the listing link are not followed.** The adapters only
  read the listing page; they do not open a notice's detail page to harvest
  further PDFs.
- **One page of each source.** Pagination/AJAX paging is not crawled yet
  (~500 archived notifications, ~180 academic calendars).
- **The `notifications` category is coarse.** As above, everything lands in
  `general` until an admin re-categorises it.
- **External links in the `others` pane.** Items there may point at
  `results.jntuh.ac.in` etc. Those are recorded as the source URL but carry no
  document and are usually not a "notice" — review them by hand.
- **No `robots.txt` exists** on either host (both return 404). The collector
  issues two polite requests per run with a 1.5 s gap, but the crawl policy
  should be re-checked before scheduling anything.
- **The site's markup is not versioned.** A redesign will break the parsers.
  That failure is loud (a `ParseError` and exit code `1`), not silent — but it
  will need a human to update the adapter.

---

## Adding another source adapter

1. Create `collector/sources/<name>.mjs` exporting:

   ```js
   export const SOURCE = Object.freeze({
     id: "academic-calendars",       // must be unique; used as the dedup namespace
     name: "JNTUH Academic Calendars",
     listingUrl: "https://jntuh.ac.in/academic-calendars",
     description: "…",
     categoryDefault: "calendar",    // an id from src/data/alertSources.js
   });

   export function hasSkeleton(html) { /* does this look like the page we expect? */ }
   export function parse(html, options) { /* -> { notices, warnings } or throws ParseError */ }
   export async function fetchListing(options) { /* GET the page, then check for an access wall */ }
   ```

2. Register it in `collector/index.mjs`:

   ```js
   import academicCalendars from "./sources/academic-calendars.mjs";
   const REGISTRY = [notifications, exams, academicCalendars];
   ```

3. Each parsed notice must be a plain object shaped like this:

   ```js
   {
     sourceId, sourceName, listingUrl, category,
     title,           // cleaned, entity-decoded, may be empty (adapter skips those)
     dateRaw,         // original string, for diagnostics
     noticeDate,      // Date or null — never guess
     noticeHref,      // raw href as the page had it
     sourceUrl,       // canonical notice URL, or the listing URL as a flagged fallback
     sourceUrlFallback,
     documentUrl,     // canonical file URL, or null when the link is a page
     canonicalUrl,    // identity for dedup: documentUrl-or-sourceUrl, or null
     attachments,     // any other file links found in the same cell
     position,
   }
   ```

4. Add an HTML fixture under `collector/tests/fixtures/` saved from the real
   page, plus tests in `collector/tests/<name>.test.mjs`. Fixture-based tests
   are mandatory — a passing HTTP request is not proof that parsing works.

### Rules for every adapter

- **Only extract what the page actually supports**: title, date, source name,
  source URL, document URL, attachment URLs. If a field is missing, return
  `null`/`""` and flag it — never invent it.
- **Check a structural marker first** (`hasSkeleton`). If the site changes
  shape, throw a `ParseError` with a human-readable message. An adapter must
  never return zero notices because it silently failed to match anything.
- **Fetch politely**: use `fetchText` from `collector/lib/http.mjs`. It applies
  the timeout, the retry-with-backoff, the User-Agent and the inter-request gap,
  and it refuses to retry through `401/403/429/511` responses. Do not add a
  second HTTP client.
- **Do not bypass anything.** No logins, no cookies, no CAPTCHA solving, no
  browser-UA spoofing to dodge a bot wall. If a page starts requiring
  authentication, raise an error and stop.
- **Do not add dependencies** without a stated reason.

---

## Why automatic publication is disabled

`firestore.rules` enforces this invariant on the `alerts` collection:

```
status in ['draft','published']
  && (status != 'published'
      || (publishedAt is timestamp
          && verifiedAt is timestamp
          && verifiedBy is a string with size > 0))
```

An alert becomes public only after a `verifiedAt`/`verifiedBy` pair, which only
an authenticated administrator can set (`publishAlert` in `src/lib/alerts.js`).
The collector **cannot** satisfy this, by construction:

- `toAlertDraft()` hard-codes `status: "draft"`, `verifiedAt: null`,
  `verifiedBy: ""` and `pinned: false`;
- `assertDraftOnly()` throws if any of those are violated or if the object
  carries a key outside the 18 allowed by `keys().hasOnly([...])`.

The reasons to keep it that way:

1. **The sources are unverified.** A listing row gives a title and a link. Nobody
   has confirmed the notice is current, applies to the reader's year/branch, or
   is not superseded. Surfacing that automatically would put unreviewed claims in
   front of students under the university's name.
2. **Titles are not content.** Several notices are one-line pointers to a PDF
   whose actual content may say something narrower than its title.
3. **A scraped field can be wrong.** Dates in particular are sometimes absent or
   malformed; the collector reports them as missing rather than guessing, but a
   wrong-but-plausible date is worse than no date.
4. **Mistakes are hard to undo.** A wrong alert is seen by everyone who loads
   `/alerts`, and pushes real notices out of view. The cost of a mistake is far
   higher than the cost of a human clicking *Verify* and *Publish*.
5. **It is the site's stated contract.** The public disclaimer already says the
   Alert Radar aggregates links to official sources and is not itself an
   official JNTUH channel. Auto-publishing would quietly weaken that.

So the collector produces drafts, an administrator reviews them in
`/admin/alerts`, and only then do they become public.

---

## Where collector bookkeeping lives

`firestore.rules` validates alert documents with `keys().hasOnly([...])`, so
**no extra field may ever be added to an alert document.** Everything the
collector records beyond the alert schema — canonical URL, document URL,
attachments, content hash, review metadata — lives in its own staging
collections instead:

- `ingestItems` — one document per staged notice, plus the review fields an
  administrator may change (`reviewState`, `promotedAlertId`, `promotedAt`,
  `promotedBy`);
- `ingestRuns` — one document per collector run (counts, status, warnings);
- `ingestSourceHealth` — one document per official source.

All three are admin-only in `firestore.rules`: only administrators may read
them, the collector writes them through the Admin SDK, and a browser may change
only the four review fields on `ingestItems`. The public `alerts` collection is
never written by the collector.

---

## Remaining work

- Decide the scheduler (GitHub Actions cron vs. Cloud Functions) and whether the
  project moves to the Blaze plan. Nothing is scheduled today: a run is a manual
  command and dry run is the default.
- Persisting the dedup baseline so cross-run duplicate detection is automatic
  rather than supplied via `--baseline`.
- Extending the `notifications` adapter to crawl the older archived rows
  (~500 of them are only reachable through the site's own AJAX paging).
- Deciding a retention/pruning policy for staged notices once they are promoted
  or ignored; there is no automatic cleanup yet.
