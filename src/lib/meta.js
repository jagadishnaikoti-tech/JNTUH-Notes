// ---------------------------------------------------------------------------
// Route -> SEO resolver for the React app.
//
// Turns a pathname into a route descriptor using the real content metadata,
// then asks the shared, dependency-free src/lib/seo.js module for the
// title/description/canonical/robots/JSON-LD. The visible Breadcrumbs
// component and the build-time generator use the same descriptor + builders,
// so the client-rendered <head> and the prerendered HTML never diverge.
// ---------------------------------------------------------------------------

import { getResourceByFolderId, getYear } from "../data/site.js";
import {
  QUESTION_CATEGORY_META,
  buildCrumbs,
  normalizePath,
  seoFor,
} from "./seo.js";

/** Build a self-contained descriptor for a pathname. */
export function describeRoute(pathname) {
  const path = normalizePath(pathname);

  switch (path) {
    case "/":
      return { kind: "home", path };
    case "/years":
      return { kind: "years", path };
    case "/code":
      return { kind: "code", path };
    case "/search":
      return { kind: "search", path };
    case "/sitemaps":
      return { kind: "sitemaps", path };
    case "/privacy-policy":
      return { kind: "privacy", path };
    case "/terms-and-conditions":
      return { kind: "terms", path };
    case "/signin":
      return { kind: "signin", path };
    case "/signup":
      return { kind: "signup", path };
    case "/forgot-password":
      return { kind: "forgot", path };
    case "/account":
      return { kind: "account", path };
    default:
      break;
  }

  const questionMatch = /^\/questions\/([^/]+)$/.exec(path);
  if (questionMatch) {
    const categoryId = questionMatch[1];
    return { kind: "questions", path, categoryId };
  }

  const yearMatch = /^\/year\/([^/]+)$/.exec(path);
  if (yearMatch) {
    const year = getYear(yearMatch[1]);
    if (year) {
      return {
        kind: "year",
        path,
        yearId: String(year.id),
        yearName: year.name,
      };
    }
    return { kind: "notfound", path };
  }

  const subjectMatch = /^\/subject\/([^/]+)\/([^/]+)$/.exec(path);
  if (subjectMatch) {
    const [, groupId, folderId] = subjectMatch;
    const resource = getResourceByFolderId(folderId);
    if (resource) {
      const ym = /^year(\d)$/.exec(groupId);
      const year = ym ? getYear(ym[1]) : null;
      return {
        kind: "subject",
        path,
        groupId,
        label: resource.label,
        yearId: year ? String(year.id) : undefined,
        yearName: year ? year.name : undefined,
      };
    }
  }

  return { kind: "notfound", path };
}

/** Resolve { title, description, canonical, robots, jsonLd, crumbs, ... }. */
export function getRouteMeta(pathname) {
  const descriptor = describeRoute(pathname);
  return { ...seoFor(descriptor), crumbs: buildCrumbs(descriptor), descriptor };
}

export { QUESTION_CATEGORY_META };
