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

- `index.html` + `assets/` (app JS/CSS)
- favicon set (`favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`),
  `og-image.png` (1200×630 social card), `site.webmanifest`
- `robots.txt` (allows crawling, references the absolute sitemap URL)
- `sitemap.xml` (built from the real route + resource inventory, 65 URLs)
- one static HTML document per canonical route, both as `dist/<route>/index.html`
  and `dist/<route>.html` (see section 2)

There is no server code and no environment variables.

### SPA routing

`vercel.json` enables `cleanUrls: true` and contains the rewrite that sends
unknown paths to `index.html`:

```json
{
  "cleanUrls": true,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Vercel serves real static files (assets, favicons, `robots.txt`, `sitemap.xml`,
`og-image.png`, and every prerendered `<route>/index.html` / `<route>.html`)
before the rewrite, so only genuinely missing paths fall through to the app.
This is what makes deep links such as `/year/2`, `/questions/guaranteed` and
`/privacy-policy` work on a hard refresh — with correct per-page metadata in
the raw HTML. Any other static host must configure the equivalent SPA fallback.

---

## 2. SEO build output

Every canonical, indexable page gets unique `<title>`, meta description,
`robots`, canonical, Open Graph, Twitter Card and JSON-LD tags **in the raw HTML
served to crawlers** — no JavaScript required. This is generated at build time
from the actual content metadata (`src/data/resources.json` + `src/lib/seo.js`),
so it can never drift from the site.

| Item | What is generated |
| --- | --- |
| Per-route HTML | `dist/<route>/index.html` + `dist/<route>.html` for all 66 routes (home, years, subjects, question sets, coding resources, legal pages, search) |
| Canonical URLs | Absolute, HTTPS, no trailing slash, one URL per page (`https://jntuh-notes.vercel.app/<route>`) |
| Structured data | `WebSite` (with `SearchAction`) on the home page; `BreadcrumbList` on every other page — matching the visible breadcrumbs |
| `sitemap.xml` | 65 indexable URLs (search excluded); well-formed XML; regenerated on every build |
| `robots.txt` | Allows all public content, points to the absolute sitemap URL |
| `noindex` | Applied only to `/search` (utility page, excluded from the sitemap) and to the client-rendered 404 |
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

No analytics or tracking scripts are installed (nothing collects personal data).
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
| `sitemap.xml` (65 URLs, well-formed, canonical, from real data) | ✅ validated |
| `robots.txt` (allow-all + sitemap reference) | ✅ in place |
| Structured data (`WebSite` + `BreadcrumbList`) | ✅ validates (JSON-LD parse-checked on all routes) |
| Open Graph / Twitter card + `og-image.png` | ✅ in place |
| Lighthouse a11y / best-practices / SEO (home, subject, Q&S) | ✅ 100 / 100 / 100 |
| Google Search Console property verified + sitemap submitted | ⛔ **blocked — needs owner access to the property** (steps in section 5) |
| **Custom domain attached + verified** | ⛔ **blocked — requires the real domain + DNS access** |
| HTTPS + redirects verified on the custom domain | ⛔ blocked with the above |

The site is ready to ship; the outstanding launch items (custom domain, Search
Console verification) require owner access and cannot be done from this
repository.