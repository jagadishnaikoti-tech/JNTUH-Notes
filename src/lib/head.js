// ---------------------------------------------------------------------------
// Applies per-route SEO data to the live <head> during client-side navigation.
//
// The production build ships prerendered HTML where these tags already exist
// for every canonical route (see scripts/gen-seo.mjs). This module keeps them
// in sync when the visitor moves between routes without a full page load, so
// the rendered <head> always matches the current URL.
// ---------------------------------------------------------------------------

import { getRouteMeta } from "./meta.js";

function setMeta(attr, key, content) {
  if (typeof document === "undefined" || content == null) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  if (typeof document === "undefined" || !href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setRouteJsonLd(jsonLd) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("ld-route");
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "ld-route";
    document.head.appendChild(el);
  }
  el.textContent = jsonLd ? JSON.stringify(jsonLd) : "";
}

/** Update document.title, meta tags, canonical link and JSON-LD for a path. */
export function applyRouteHead(pathname) {
  if (typeof document === "undefined") return;
  const meta = getRouteMeta(pathname);

  document.title = meta.title;
  setMeta("name", "description", meta.description);
  setMeta("name", "robots", meta.robots);
  setLink("canonical", meta.canonical);

  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:url", meta.canonical);
  setMeta("property", "og:image", meta.ogImage);

  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);
  setMeta("name", "twitter:image", meta.ogImage);

  setRouteJsonLd(meta.jsonLd);
}
