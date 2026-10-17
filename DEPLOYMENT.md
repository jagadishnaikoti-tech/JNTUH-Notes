# Deployment, SEO & custom domain

This document covers how the site is built, how it is served, the SEO build
output, Search Console readiness, and the exact steps to attach a **custom
domain**. The custom domain step is a launch blocker and is **not yet done** —
no domain name, registrar or DNS access is available in this repository, so
nothing here invents one.

---

## 1. Build output

```bash
npm install
npm run build     # -> ./dist
```

`npm run build` runs `vite build` first, then the SEO generator
(`node scripts/gen-seo.mjs`). `./dist` is a fully static bundle:

- `index.html` + `assets/` (app JS/CSS). React and the resource inventory are
  split into their own cacheable chunks, and the whole `/admin/*` area (plus the
  Firebase Auth/Firestore/Analytics SDKs) is a lazy chunk that public visitors
  never download.
- favicon set (`favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`),
  `og-image.png` (1200×630 social card), `site.webmanifest`
- `robots.txt` (allows crawling, references the absolute sitemap URL)
- `sitemap.xml` (built from the real route + resource inventory, 66 URLs)
- one static HTML document per canonical route, both as `dist/<route>/index.html`
  and `dist/<route>.html` (see section 2)

There is no server code and no environment variables.

### SPA routing

`vercel.json` declares `cleanUrls: true` and the catch-all rewrite that sends
unknown paths to the SPA shell:

```json
{
  "cleanUrls": true,
  "rewrites": [{ "source": "/(.*)", "destination": "/index" }]
}
```

> **Why the destination has no `.html`:** when `cleanUrls: true` is set, Vercel
> strips the `.html` extension at build time, so the built entry document is
> addressable as `/index` (a request for `/index.html` is redirected to `/`).
> A rewrite destination of `/index.html` therefore points at a path that no
> longer exists, the rewrite resolves to nothing, and Vercel returns its
> plain-text 404. The destination must be the extension-less `/index` — this is
> the documented form for `cleanUrls` projects.

Earlier revisions combined `cleanUrls: true` with
`"destination": "/index.html"`, which is why every prerendered route still
loaded while non-prerendered paths such as `/alerts/:id` or `/admin/ingest`
returned Vercel's plain-text 404. `cleanUrls` itself was never the problem: a
request for `/index.html` or `/year/2.html` returns a `308` redirect to the
clean URL.

Real files are still served before the rewrite, so every route continues to
exist as a real file after the build. `scripts/gen-seo.mjs` writes prerendered
documents for the public routes (`dist/<route>/index.html` + `dist/<route>.html`)
**and** for the private admin routes (`dist/admin/**/index.html` +
`dist/admin/*.html`, each with a `noindex, nofollow` head and no sitemap entry).
This is what makes deep links such as `/year/2`, `/questions/guaranteed`,
`/sitemaps` and `/admin/login` load correctly on a fresh request or refresh,
independently of the rewrite. The rewrite only adds the SPA fallback for paths
that have no real file (for example `/alerts/:id`, `/admin/ingest`, or an
unknown URL), which then render the client app — including its client-side 404 —
instead of Vercel's plain-text 404.

> **Status:** the corrected `/index` destination is in the repository but is
> **not yet verified in production.** Confirm it on a Vercel **preview**
> deployment before promoting to production.

---

## 2. SEO build output

Every canonical, indexable page gets unique `<title>`, meta description,
`robots`, canonical, Open Graph, Twitter Card and JSON-LD tags **in the raw HTML
served to crawlers** — no JavaScript required. This is generated at build time
from the actual content metadata (`src/data/resources.json` + `src/lib/seo.js`),
so it can never drift from the site.

| Item | What is generated |
| --- | --- |
| Per-route HTML | `dist/<route>/index.html` + `dist/<route>.html` for all 67 public routes (home, years, subjects, question sets, coding resources, site map, legal pages, search) |
| Admin documents | `dist/admin/**/index.html` + `dist/admin/*.html` for the 6 private admin routes, each with a `noindex, nofollow` head and no sitemap entry — present only so `/admin/*` deep links resolve on the static host |
| Canonical URLs | Absolute, HTTPS, no trailing slash, one URL per page (`https://jntuh-notes.vercel.app/<route>`) |
| Structured data | `WebSite` (with `SearchAction`) on the home page; `BreadcrumbList` on every other page — matching the visible breadcrumbs |
| `sitemap.xml` | 66 indexable URLs (search excluded); well-formed XML; regenerated on every build |
| `robots.txt` | Allows all public content, points to the absolute sitemap URL |
| `noindex` | Applied to `/search` (utility page, excluded from the sitemap), to the client-rendered 404, and to every `/admin/*` document (`noindex, nofollow`) |
| Social sharing | `og-image.png` (real brand asset) + OG/Twitter tags on every page |

### Crawling / rendering model (honest assessment)

This is a **client-rendered React SPA**. Two things make it indexable:

1. The prerendered `<head>` above is correct for every route in raw HTML, so
   non-JS crawlers and all social scrapers see accurate metadata immediately.
2. Googlebot renders JavaScript, so the actual page content (subject lists,
   file trees, question sets) is crawlable and indexable — this was verified
   locally with Lighthouse and by direct-load route checks.

What the static documents do **not** contain is the rendered body markup
(React still mounts on the client to render it). If body-level prerendering
(SSR/headless capture of the full DOM) is ever required, that needs a headless
browser build step — out of scope for this repository and not required for
Google indexation today.

### Note on local `vite preview`

`vite preview` serves extensionless nested paths through the SPA fallback and
only serves the static documents for trailing-slash URLs (e.g. `/year/2/`) or
explicit `.html` URLs. Vercel's static file handling is different: it serves
`<route>/index.html` and (with `cleanUrls`) `<route>.html` for `/route`. So
validate the prerendered head on the actual deployment, not just locally.

---

## 3. Current hosting

- The production URL is **https://jntuh-notes.vercel.app/** (Vercel project).
- The repository contains **no** `.vercel/` directory, so the project is linked
  to Vercel through the dashboard, not the CLI.
- No custom domain is configured in the repository.
- The canonical origin used for all SEO URLs is `https://jntuh-notes.vercel.app/`
  (single source of truth in `src/lib/seo.js`). If a custom domain is attached
  later, update it there (and in `public/robots.txt`) before deploying.

---

## 4. Attaching a custom domain (blocked — owner action)

A real domain name and access to the Vercel project (or its DNS provider) are
required. Once available:

1. **Add the domain in Vercel.** Project → *Settings* → *Domains* → add the
   apex domain and the `www` host.
2. **Copy the exact DNS records Vercel shows** for that project. Vercel displays
   the required record type, name and value for the specific domain; use those
   values verbatim. Do **not** hard-code IP addresses or CNAME targets from
   memory — Vercel's values change and the dashboard is authoritative.
3. **Create the records at the registrar / DNS provider**, then return to the
   Vercel dialog and wait for the domain to show as **Valid Configuration**.
4. **HTTPS** is provisioned automatically by Vercel once DNS resolves; wait for
   the certificate to become active.
5. **Choose the canonical host** and redirect the other to it (Vercel offers a
   one-click redirect between apex and `www`).
6. **Update the canonical origin** in `src/lib/seo.js` (`SITE_ORIGIN`) and the
   `Sitemap:` line in `public/robots.txt` to the chosen domain, then redeploy.

### Verification after attaching

- `https://<domain>/` loads the app over HTTPS with no certificate warning.
- `http://<domain>/` redirects to `https://`.
- The non-canonical host (`www` or apex) redirects to the canonical one.
- Hard-refresh a deep link, e.g. `https://<domain>/privacy-policy`, and confirm
  it renders (not a 404).
- `https://<domain>/robots.txt` returns the text file; `https://<domain>/sitemap.xml`
  returns XML with 65 URLs.
- View the page source of `/year/2` and confirm its own `<title>`, meta
  description, canonical and JSON-LD are present (not the homepage defaults).

---

## 5. Search Console & analytics readiness

Two analytics layers are installed:

- **GA4** (`G-VQGHZND2J7`) via the manual `gtag.js` tag in `index.html`.
- **First-party visitor analytics** — page views and PDF open/view/download
  clicks written to Firebase Firestore and mirrored to GA4. No IP addresses,
  emails or user-agent strings are stored; visitors are counted with an
  anonymous random browser id. Consent handling is opt-in via
  `VITE_REQUIRE_CONSENT` (default `false`).

Both are aggregate reporting only and are **not** used for security decisions.
The private admin panel lives at `/admin/*` (excluded in `robots.txt`, served
`noindex, nofollow`) and requires the Firebase `admin` custom claim. Full setup
is in [`docs/ADMIN_SETUP.md`](docs/ADMIN_SETUP.md).

For Google Search Console:

1. **Verify the property.** Recommended: a **URL-prefix property** for
   `https://jntuh-notes.vercel.app/` using the **HTML file upload** method
   (drop the `google<code>.html` file into `public/` and commit — Vercel serves
   it). A domain-level property requires DNS access and is optional. Do not
   claim verification until Search Console confirms it.
2. **Submit the sitemap.** *Sitemaps* → enter `sitemap.xml` (relative to the
   root) and submit. It is regenerated on every deploy.
3. **Inspect important URLs.** Use *URL inspection* for `/`, `/years`,
   `/year/1..4`, a few subject pages, and `/questions/guaranteed`. Request
   indexing after confirming "URL is on Google".
4. **Monitor.** Track *Indexing*, *Performance* (impressions/clicks/queries) and
   the *Sitemaps* report over time. Crawl stats live in *Settings → Crawl stats*.
5. **If/when a custom domain is attached**, verify a new property for it and
   resubmit the sitemap; the old `*.vercel.app` property will decline on its own.

---

## 6. Launch status

| Item | Status |
| --- | --- |
| Production build (`npm run build`, incl. sitemap + prerendered head) | ✅ passing |
| SPA deep-link refresh | ✅ confirmed locally via `vite preview` |
| Per-route title/description/canonical/robots (66 documents) | ✅ 66 unique, validated |
| `sitemap.xml` (66 URLs, well-formed, canonical, from real data) | ✅ validated |
| `robots.txt` (allow-all + sitemap reference) | ✅ in place |
| Structured data (`WebSite` + `BreadcrumbList`) | ✅ validates (JSON-LD parse-checked on all routes) |
| Open Graph / Twitter card + `og-image.png` | ✅ in place |
| Lighthouse a11y / best-practices / SEO (home, subject, Q&S) | ✅ 100 / 100 / 100 |
| Google Search Console property verified + sitemap submitted | ⛔ **blocked — needs owner access to the property** (steps in section 5) |
| **Custom domain attached + verified** | ⛔ **blocked — requires the real domain + DNS access** |
| HTTPS + redirects verified on the custom domain | ⛔ blocked with the above |
| Public site tracking (page views + PDF clicks) | ✅ wired and browser-verified (no console errors) |
| Admin panel sign-in / guards / empty states | ✅ wired; login error handling verified |
| Firebase project setup (Email/Password, Firestore, rules, first admin, env vars) | ⛔ **blocked — owner action**, see `docs/ADMIN_SETUP.md` |

The site is ready to ship; the outstanding launch items (custom domain, Search
Console verification) require owner access and cannot be done from this
repository.