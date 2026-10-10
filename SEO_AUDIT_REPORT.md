# SEO Audit & Implementation Report — JNTUH Notes

**Date:** 2026-10-10
**Site:** https://jntuh-notes.vercel.app/ (client-rendered React SPA on Vercel)
**Scope:** Full-site technical SEO: metadata, crawlability, sitemap, robots,
structured data, social sharing, performance, accessibility.

---

## 1. Executive summary

The site had solid client-side architecture (per-route titles/descriptions set
after JS loads) but was effectively invisible to non-JS crawlers and social
scrapers: every URL served identical homepage metadata in raw HTML, there was no
canonical, no sitemap (the `/sitemap.xml` URL returned the SPA's HTML), no
Open Graph/Twitter tags, and no structured data.

This has been fixed at build time and at runtime:

- **Prerendered, per-route HTML** for all 66 canonical routes with unique
  `title`, `description`, `robots`, `canonical`, Open Graph, Twitter and
  JSON-LD in the raw HTML served to crawlers.
- **`sitemap.xml`** (65 indexable URLs) generated from the real resource
  inventory on every build.
- **`robots.txt`** now references the absolute sitemap URL.
- **Client-side head manager** keeps every tag in sync during SPA navigation.
- **Breadcrumbs fixed** on question-set and legal pages (previously "Home ›
  Not found") and exposed as `BreadcrumbList` JSON-LD.
- **`og-image.png`** brand social card + manifest + font-loading improvements.
- **Heading-order a11y bug** fixed on subject pages.

Lighthouse (accessibility / best-practices / SEO): **100 / 100 / 100** on the
home, subject and question-set pages. Custom-domain and Search Console work
remain **blocked on owner access** (documented in `DEPLOYMENT.md`).

---

## 2. Audit findings (before → after)

### Critical
| # | Finding | Status |
| --- | --- | --- |
| C1 | `/sitemap.xml` returned `text/html` (the SPA shell) — a valid XML sitemap did not exist | ✅ Fixed — generated `sitemap.xml`, 65 URLs, well-formed, content-type `text/xml` |
| C2 | No canonical tags on any page | ✅ Fixed — absolute HTTPS canonical per page, single host, no trailing slash |
| C3 | All routes served the homepage `title`/description in raw HTML (empty `<div id="root">`) | ✅ Fixed — 66 prerendered route documents with correct raw `<head>` |
| C4 | No Open Graph / Twitter Card tags → broken previews on Facebook/X/LinkedIn/WhatsApp/Telegram | ✅ Fixed — per-page OG/Twitter tags + `og-image.png` brand card |

### High
| # | Finding | Status |
| --- | --- | --- |
| H1 | Subject pages all used the generic title "Subject Study Material \| JNTUH Notes" | ✅ Fixed — real subject names + year, e.g. "DBMS Notes \| JNTUH B.Tech 2nd Year" |
| H2 | Titles duplicated across year pages (e.g. "Important Questions" x3) | ✅ Fixed — all 66 titles now unique |
| H3 | `/search` (utility page) was indexable | ✅ Fixed — `noindex, follow` in prerendered HTML and on client navigation; excluded from sitemap |
| H4 | Breadcrumbs showed "Home › Not found" on `/questions/*` and legal pages | ✅ Fixed — shared crumb logic covers every route |
| H5 | No structured data | ✅ Fixed — `WebSite` (+ `SearchAction`) on home, `BreadcrumbList` on all other pages; JSON-LD parses on all 66 routes |
| H6 | `robots.txt` had no `Sitemap:` directive | ✅ Fixed |
| H7 | Unknown/404 routes returned soft-200 with indexable metadata | ✅ Partial — client renders `noindex` + "Page Not Found" for unknown paths; static 404 status requires Vercel Functions (out of scope, documented) |
| H8 | Heading-order a11y failure on subject pages (h1 → h3 skip) | ✅ Fixed — sequential heading hierarchy |

### Medium
| # | Finding | Status |
| --- | --- | --- |
| M1 | Fonts loaded via CSS `@import` (render-blocking chain) | ✅ Fixed — preconnect + `<link>` stylesheet in `<head>` |
| M2 | No web app manifest (site identity) | ✅ Fixed — `site.webmanifest` |
| M3 | No branded social preview image | ✅ Fixed — `og-image.png` (1200×630, real brand assets, generated in-repo) |
| M4 | Client-side head updates only covered title/description (not canonical/OG/JSON-LD) | ✅ Fixed — `applyRouteHead()` updates all head tags per route |
| M5 | Homepage meta description 207 chars | ✅ Trimmed to 169 |

### Low
| # | Finding | Status |
| --- | --- | --- |
| L1 | No internal links to `/subject/syllabus/*` and `/subject/learncode/*` (orphans mirroring external Drive folders) | ⚠️ Documented — intentionally excluded from the sitemap (they duplicate external Google Drive folders); reachable via in-app search |
| L2 | PDFs are links to the original Google Drive documents | ✅ Verified — all document links point at real Drive file URLs from `resources.json` (no broken/placeholder links introduced) |

---

## 3. Files changed

| File | Change |
| --- | --- |
| `src/lib/seo.js` | **New** — dependency-free SEO core: canonical origin, page copy, JSON-LD builders, breadcrumbs; shared by app + build |
| `src/lib/meta.js` | Rewritten — pathname → route descriptor → SEO data (uses real year/subject labels) |
| `src/lib/head.js` | **New** — applies title/description/robots/canonical/OG/Twitter/JSON-LD during SPA navigation |
| `src/App.jsx` | Uses `applyRouteHead()` per route |
| `src/components/Breadcrumbs.jsx` | Rewritten — uses shared crumb trail (fixes Q&S + legal pages; matches JSON-LD) |
| `src/pages/SubjectPage.jsx` | Sequential heading hierarchy (sr-only `<h2>` before file tree) |
| `scripts/gen-seo.mjs` | **New** — build-time generator: 66 prerendered route docs + `sitemap.xml` |
| `index.html` | SEO marker block, OG/Twitter/robots/canonical defaults, manifest, preconnect+font `<link>`, no-JS fallback nav |
| `src/styles/tokens.css` | Removed font `@import` (now a `<link>` in `index.html`) |
| `public/robots.txt` | `Sitemap:` directive added |
| `public/site.webmanifest` | **New** |
| `public/og-image.png` | **New** — generated brand social card |
| `tools/gen-og-image.mjs` | **New** — dependency-free generator for the OG image |
| `vercel.json` | `cleanUrls: true` added (serves prerendered `<route>.html` at `/route`) |
| `package.json` | `build` now runs `vite build && node scripts/gen-seo.mjs` |
| `README.md`, `DEPLOYMENT.md` | SEO build output + Search Console steps documented |

---

## 4. Keyword & search-intent strategy (hypothesis — no fabricated data)

No keyword tool access was available in this environment, so volumes and
competition are **not claimed**. The themes below are hypotheses derived from
the site's real content and the master-prompt brief:

| Intent cluster | Primary page(s) | Page intent |
| --- | --- | --- |
| "jntuh notes", "jntuh b.tech notes (R22)" | `/` | Overview + find material by year/subject |
| "jntuh notes 1st/2nd/3rd/4th year" | `/year/1..4` | Year-level browse |
| "<subject> notes jntuh b.tech" | `/subject/yearN/<folder>` | Subject document access |
| "jntuh important/guaranteed questions" | `/questions/guaranteed` | Exam priority revision |
| "jntuh short questions / 2 marks" | `/questions/short` | Quick revision |
| "jntuh coding/placement resources" | `/code` | Career resources |
| Subject-specific (DBMS, COA, ML, OS…) | subject pages | Direct document access |

Each page maps to one primary intent and gets a unique title/description that
answers it; no keyword stuffing, no invented statistics, no fake pages.

---

## 5. Canonical & URL strategy

- Single canonical origin: `https://jntuh-notes.vercel.app/` (verified
  deployment; custom domain blocked on owner).
- One canonical URL per page, absolute, HTTPS, no query/fragment, no trailing
  slash; canonical updated on client navigation too.
- No page is canonicalized to the homepage; question-set, legal and search
  pages each carry their own canonical.
- Existing routes were preserved unchanged.

---

## 6. Structured data

- **Home:** `WebSite` with `SearchAction` targeting the real `/search?q=` URL.
- **All other pages:** `BreadcrumbList` matching the visible breadcrumbs.
- No `Organization`, `Review`, `Rating`, `FAQPage`, or other markup not
  supported by real content.
- Validation: JSON-LD parsed successfully for all 66 route documents.

---

## 7. Rendering & crawlability assessment

This is a **client-rendered SPA**. Assessment:

1. **Metadata is now crawlable without JS** via the prerendered documents.
2. **Body content is indexed through Googlebot's JS rendering** (each page
   renders real subject/file/question content; verified by direct-load route
   checks and Lighthouse).
3. All navigation remains standard `<a href>` links; no JS-only exposure of
   essential routes.
4. **Known limitation (honest):** the prerendered docs carry correct `<head>`
   but not the rendered body markup. Full SSR/headless prerendering of body
   HTML was evaluated and rejected as a large, risky change (would require a
   headless-browser build step or a framework migration) with no demonstrated
   benefit for Google indexation today. Documented in `DEPLOYMENT.md`.

---

## 8. Test results (actual, reproducible)

| Test | Result |
| --- | --- |
| `npm run build` (vite + gen-seo) | ✅ Pass — 66 route documents + sitemap.xml (65 URLs) |
| All 66 route docs validated | ✅ 66/66 unique titles, 66/66 unique descriptions, 0 problems (missing tags, canonical mismatch, JSON-LD parse, robots expectations) |
| `sitemap.xml` well-formed XML | ✅ `[xml]` parse: 65 `url` nodes; all `loc` absolute HTTPS on the canonical host; unique; `/search` excluded |
| `robots.txt` served | ✅ `text/plain`, allow-all, absolute sitemap reference |
| Static assets | ✅ `sitemap.xml` → `text/xml`; `og-image.png` → `image/png`; `site.webmanifest` → `application/manifest+json`; fonts 200 |
| Direct-load routes (`/year/2`, subject, `/search`, legal) | ✅ Prerendered `<head>` served without JS (title, canonical, robots, JSON-LD) |
| SPA navigation | ✅ Title/description/canonical/OG/robots/JSON-LD update per route (no page load) |
| Breadcrumbs | ✅ "Home › Guaranteed Questions", "Home › 2nd Year › DBMS", legal pages — no more "Not found" |
| Soft-404 | ✅ Client renders "Page Not Found" + `noindex, follow` for unknown paths |
| Lighthouse (home, subject, question sets) | ✅ accessibility 1.0 / best-practices 1.0 / SEO 1.0 |
| Console errors during all route checks | ✅ none |
| Live deployment parity | ⚠️ The live `*.vercel.app` deployment matches the pre-change source; the new build requires a redeploy (owner action) |

---

## 9. Remaining limitations

1. **Body-level prerendering** (full SSR of page content into static HTML) is
   not implemented — see section 7.
2. **Static 404 status**: unknown URLs return 200 with a client-rendered
   `noindex` 404. A true 404 status needs a Vercel Function (not added to keep
   the project static and dependency-free).
3. **Orphan routes** `/subject/syllabus/*` and `/subject/learncode/*` mirror
   external Google Drive folders; excluded from the sitemap by design.
   Reconsider if a custom domain changed their purpose.
4. **Pre-existing content gaps** (reported as-is, not introduced): Learn
   Code→PLACEMENT external URL 404; 4th Year→SMS and →Important Questions
   empty; 4th Year→SVP disabled tile; year-4 "Important Questions" folder has
   0 files.
5. **Live site not yet redeployed** with these changes; the canonical origin
   remains the `*.vercel.app` host until a custom domain is attached.

---

## 10. Manual steps required (owner access)

1. **Redeploy** the new build to Vercel (push/`vercel --prod`).
2. **Verify** `/sitemap.xml`, `/robots.txt`, `/og-image.png`, and the source of
   `/year/2` (its own title/canonical, not the homepage's).
3. **Google Search Console** — create a URL-prefix property for
   `https://jntuh-notes.vercel.app/` (HTML-file verification: add
   `google<code>.html` to `public/` and commit), submit `sitemap.xml`, then use
   URL Inspection on `/`, `/years`, `/year/1..4`, representative subjects and
   `/questions/guaranteed`. Full steps in `DEPLOYMENT.md` §5.
4. **Custom domain** (launch blocker) — attach the real domain in Vercel, copy
   the exact DNS records Vercel shows, verify, then update `SITE_ORIGIN` in
   `src/lib/seo.js` + the `Sitemap:` line in `public/robots.txt` and redeploy.
5. Do **not** claim "indexed" or "ranked" until Search Console shows actual
   indexed URLs and post-deployment data.

---

## 11. Recommended next priorities

1. Attach + verify the custom domain and update the canonical origin
   (unblocks canonical consistency and HTTPS verification).
2. Verify the property in Search Console and submit the sitemap.
3. Monitor Indexing + Performance reports for 4–8 weeks; fix any pages flagged
   as "Crawled – currently not indexed".
4. If organic visibility justifies it, evaluate body-level prerendering via a
   headless-browser build step (do not migrate to Next.js without evidence).
5. Consider fixing the pre-existing content gaps (PLACEMENT 404, empty year-4
   folders) — thin/indexing-blocked pages — as content becomes available.