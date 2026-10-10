# Deployment & custom domain

This document covers how the site is built, how it is served, and the exact
steps to attach a **custom domain**. The custom domain step is a launch
blocker and is **not yet done** — no domain name, registrar or DNS access is
available in this repository, so nothing here invents one.

---

## 1. Build output

```bash
npm install
npm run build     # -> ./dist
```

`./dist` is a static bundle (`index.html`, `assets/`, favicon set, `robots.txt`).
There is no server code and no environment variables.

### SPA routing

`vercel.json` contains the rewrite that sends unknown paths to `index.html`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Vercel serves real static files (assets, favicons, `robots.txt`) first, so only
genuinely missing paths fall through to the app. This is what makes deep links
such as `/year/2`, `/questions/guaranteed` and `/privacy-policy` work on a hard
refresh. Any other static host must configure the equivalent SPA fallback.

---

## 2. Current hosting

- The production URL is **https://jntuh-notes.vercel.app/** (Vercel project).
- The repository contains **no** `.vercel/` directory, so the project is linked
  to Vercel through the dashboard, not the CLI.
- No custom domain is configured in the repository.

---

## 3. Attaching a custom domain (blocked — owner action)

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

### Verification after attaching

- `https://<domain>/` loads the app over HTTPS with no certificate warning.
- `http://<domain>/` redirects to `https://`.
- The non-canonical host (`www` or apex) redirects to the canonical one.
- Hard-refresh a deep link, e.g. `https://<domain>/privacy-policy`, and confirm
  it renders (not a 404).
- `https://<domain>/robots.txt` returns the text file.
- View the page source and confirm `<title>`, meta description, `theme-color`
  and the favicon `<link>` tags are present.

---

## 4. Launch status

| Item | Status |
| --- | --- |
| Production build (`npm run build`) | ✅ passing |
| SPA deep-link refresh | ✅ confirmed locally via `vite preview` |
| Favicon / robots.txt / meta | ✅ in place |
| Lighthouse (home / search / Q&S) | ✅ 100 / 100 / 100 |
| **Custom domain attached + verified** | ⛔ **blocked — requires the real domain + DNS access** |
| HTTPS + redirects verified on the custom domain | ⛔ blocked with the above |

The site is ready to ship; the only outstanding launch requirement is
attaching and verifying the real custom domain, which cannot be done from this
repository.
