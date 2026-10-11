// ---------------------------------------------------------------------------
// Build-time SEO generator.
//
// Runs after `vite build`. It reads the freshly built dist/index.html as a
// template and, using the same pure logic the app uses at runtime, writes:
//
//   1. A per-route HTML file (dist/<route>/index.html) whose <head> carries the
//      correct title, description, robots, canonical, Open Graph, Twitter and
//      JSON-LD for that URL. Vercel serves static files before the SPA rewrite,
//      so crawlers and social scrapers get accurate metadata without running
//      JavaScript (Googlebot additionally renders the client app for content).
//
//   2. dist/sitemap.xml, generated from the real route + resource inventory so
//      it can never drift from the site.
//
// The route inventory is derived from src/data/resources.json (the actual
// crawled content), never from a hardcoded placeholder list.
//
// Run with: node scripts/gen-seo.mjs
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  YEAR_NAMES,
  canonicalUrl,
  normalizePath,
  seoFor,
} from "../src/lib/seo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

const resources = JSON.parse(
  readFileSync(join(ROOT, "src", "data", "resources.json"), "utf8")
);

/** Full inventory of canonical, indexable HTML routes. */
function routeDescriptors() {
  const routes = [
    { kind: "home", path: "/" },
    { kind: "years", path: "/years" },
  ];

  for (const id of [1, 2, 3, 4]) {
    routes.push({
      kind: "year",
      path: `/year/${id}`,
      yearId: String(id),
      yearName: YEAR_NAMES[id],
    });
  }

  // Subject / folder pages that form the crawlable academic hierarchy
  // (year1..year4). The syllabus / learncode groups duplicate external Google
  // Drive folders and are intentionally left out of the sitemap.
  for (const [groupId, items] of Object.entries(resources.groups)) {
    const ym = /^year(\d)$/.exec(groupId);
    if (!ym) continue;
    const yearId = Number(ym[1]);
    for (const item of items) {
      if (!item.folderId) continue;
      routes.push({
        kind: "subject",
        path: `/subject/${groupId}/${item.folderId}`,
        groupId,
        label: item.label,
        yearId: String(yearId),
        yearName: YEAR_NAMES[yearId],
      });
    }
  }

  routes.push(
    { kind: "questions", path: "/questions/guaranteed", categoryId: "guaranteed" },
    { kind: "questions", path: "/questions/short", categoryId: "short" },
    { kind: "code", path: "/code" },
    { kind: "search", path: "/search" },
    { kind: "privacy", path: "/privacy-policy" },
    { kind: "terms", path: "/terms-and-conditions" },
    { kind: "sitemaps", path: "/sitemaps" }
  );

  // De-duplicate by canonical path.
  const seen = new Set();
  return routes.filter((r) => {
    const p = normalizePath(r.path);
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

// The private admin area is a separate SPA mounted outside the public layout.
// It is deliberately excluded from the public route inventory (no sitemap entry,
// noindex), but it still needs real documents on disk: this project resolves
// routes from static files, so an unknown path such as /admin/login would 404
// before React Router ever runs. These documents exist only so deep links and
// refreshes resolve; they are never linked from the public site.
const ADMIN_ROUTES = [
  { path: "/admin", title: "Admin | JNTUH Notes" },
  { path: "/admin/login", title: "Admin Sign In | JNTUH Notes" },
  { path: "/admin/dashboard", title: "Admin Dashboard | JNTUH Notes" },
  { path: "/admin/analytics", title: "Visitor Analytics | JNTUH Notes" },
  { path: "/admin/pdf-activity", title: "PDF Activity | JNTUH Notes" },
  { path: "/admin/channels", title: "Social Channels | JNTUH Notes" },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonLd(value) {
  // Escape "<" so the JSON can never terminate the surrounding <script>.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function seoBlock(seo) {
  const lines = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${escapeHtml(seo.robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(seo.siteName)}" />`,
    `<meta property="og:type" content="${escapeHtml(seo.ogType)}" />`,
    `<meta property="og:locale" content="en" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(seo.ogImage)}" />`,
    `<meta property="og:image:width" content="${seo.ogImageWidth}" />`,
    `<meta property="og:image:height" content="${seo.ogImageHeight}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(seo.ogImage)}" />`,
    `<script type="application/ld+json" id="ld-route">${
      seo.jsonLd ? jsonLd(seo.jsonLd) : ""
    }</script>`,
  ];
  return `<!--seo:start-->\n    ${lines.join("\n    ")}\n    <!--seo:end-->`;
}

// Head block for the private admin documents: no canonical, no structured data,
// no Open Graph, and explicitly noindex/nofollow so nothing here is crawled.
function adminSeoBlock(title) {
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ];
  return `<!--seo:start-->\n    ${lines.join("\n    ")}\n    <!--seo:end-->`;
}

const SEO_MARKERS = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;

function main() {
  const templatePath = join(DIST, "index.html");
  const template = readFileSync(templatePath, "utf8");

  if (!SEO_MARKERS.test(template)) {
    throw new Error(
      "dist/index.html is missing the <!--seo:start--> / <!--seo:end--> markers."
    );
  }

  const routes = routeDescriptors();
  let written = 0;
  let adminWritten = 0;

  for (const descriptor of routes) {
    const seo = seoFor(descriptor);
    const html = template.replace(SEO_MARKERS, seoBlock(seo));
    const path = normalizePath(descriptor.path);

    if (path === "/") {
      writeFileSync(templatePath, html);
    } else {
      const parts = path.split("/").filter(Boolean);
      // Directory index (dist/<route>/index.html) + flat file
      // (dist/<route>.html). Vercel serves either for /<route> (its static
      // resolution and cleanUrls both work), so crawlers always get the
      // prerendered head instead of the SPA fallback.
      const dirIndex = join(DIST, ...parts);
      mkdirSync(dirIndex, { recursive: true });
      writeFileSync(join(dirIndex, "index.html"), html);

      const flatFile =
        parts.length > 1
          ? join(DIST, ...parts.slice(0, -1), `${parts[parts.length - 1]}.html`)
          : join(DIST, `${parts[0]}.html`);
      mkdirSync(dirname(flatFile), { recursive: true });
      writeFileSync(flatFile, html);
    }
    written += 1;
  }

  // Private admin documents. They exist only so deep links and refreshes on
  // /admin/* resolve to the SPA shell even on hosts that never apply the
  // vercel.json catch-all rewrite (this deployment's host does not). They are
  // noindex and never referenced by the public site or the sitemap.
  for (const admin of ADMIN_ROUTES) {
    const html = template.replace(SEO_MARKERS, adminSeoBlock(admin.title));
    const parts = normalizePath(admin.path).split("/").filter(Boolean);

    const dirIndex = join(DIST, ...parts);
    mkdirSync(dirIndex, { recursive: true });
    writeFileSync(join(dirIndex, "index.html"), html);

    const flatFile = join(
      DIST,
      ...parts.slice(0, -1),
      `${parts[parts.length - 1]}.html`
    );
    mkdirSync(dirname(flatFile), { recursive: true });
    writeFileSync(flatFile, html);
    adminWritten += 1;
  }

  // The search UI is a utility page: it gets a noindex document above but is
  // deliberately omitted from the sitemap.
  const urls = routes
    .filter((r) => r.kind !== "search")
    .map((r) => canonicalUrl(r.path));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
  writeFileSync(join(DIST, "sitemap.xml"), xml, "utf8");

  console.log(
    `gen-seo: wrote ${written} route documents + ${adminWritten} admin documents and sitemap.xml (${urls.length} URLs).`
  );
}

main();
