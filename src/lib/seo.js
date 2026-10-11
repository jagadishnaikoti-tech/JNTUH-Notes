// ---------------------------------------------------------------------------
// SEO primitives shared by the React app (client-side <head> updates) and the
// build-time generator (scripts/gen-seo.mjs -> per-route HTML + sitemap.xml).
//
// This module is intentionally dependency-free and DOM-free so the exact same
// logic can be imported by Vite (browser bundle) and by plain Node (build
// script). It owns:
//   - the canonical origin (single source of truth)
//   - per-page <title> / description / robots builders
//   - JSON-LD builders (WebSite, BreadcrumbList)
//   - breadcrumb trails for both consumers
//
// Every string below describes real, existing content. Nothing is invented and
// no keyword stuffing is used.
// ---------------------------------------------------------------------------

// The verified production deployment. If a custom domain is configured later,
// change it here (and in public/robots.txt) so canonical/sitemap URLs stay
// consistent.
export const SITE_ORIGIN = "https://jntuh-notes.vercel.app";
export const SITE_NAME = "JNTUH Notes";
export const SITE_LOCALE = "en";
export const OG_IMAGE_PATH = "/og-image.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// Mirrors YEARS in src/data/site.js. Kept here so the build-time generator can
// read year labels without importing the browser-only site module.
export const YEAR_NAMES = {
  1: "1st Year",
  2: "2nd Year",
  3: "3rd Year",
  4: "4th Year",
};

const DEFAULT_ROBOTS = "index, follow";
const NOINDEX_ROBOTS = "noindex, follow";

// Question-set categories exposed at /questions/:category.
export const QUESTION_CATEGORY_META = {
  guaranteed: {
    crumb: "Guaranteed Questions",
    title: "JNTUH Important & Guaranteed Questions | By Subject and Year",
    description:
      "Browse JNTUH important and guaranteed question sets by year and subject, each linked to its original document. Useful for prioritising R22 exam revision.",
  },
  short: {
    crumb: "Short Questions",
    title: "JNTUH Short Questions (2 Marks) | By Subject and Year",
    description:
      "Browse JNTUH short-answer and two-mark question sets by year and subject, linked to their original documents for quick R22 exam revision.",
  },
};

/** Collapse a pathname to a canonical form: no query, no fragment, no trailing slash. */
export function normalizePath(path) {
  if (!path) return "/";
  let p = String(path).split("#")[0].split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

export function absoluteUrl(path) {
  return SITE_ORIGIN + normalizePath(path);
}

export function canonicalUrl(path) {
  return absoluteUrl(path);
}

export function ogImageUrl() {
  return SITE_ORIGIN + OG_IMAGE_PATH;
}

// --- JSON-LD ---------------------------------------------------------------

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "JNTUH B.Tech Notes",
    url: absoluteUrl("/"),
    inLanguage: SITE_LOCALE,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/search") + "?q={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.label,
      item: absoluteUrl(it.path),
    })),
  };
}

// --- page copy -------------------------------------------------------------

const HOME_TITLE = "JNTUH Notes | B.Tech CSE & AIML Study Materials (R22)";
const HOME_DESCRIPTION =
  "JNTUH B.Tech CSE & AIML (R22) study material: subject notes, important and guaranteed questions, short questions and previous papers, linked to their original documents.";

function subjectTitle(label, groupId, yearName) {
  const looksNarrative = /\bquestion|papers?\b|syllabus\b/i.test(label);
  if (groupId === "learncode") return `${label} | Coding & Placement Resources`;
  if (yearName) {
    return looksNarrative
      ? `${label} | JNTUH B.Tech ${yearName}`
      : `${label} Notes | JNTUH B.Tech ${yearName}`;
  }
  return `${label} | JNTUH Notes`;
}

function subjectDescription(label, groupId, yearName) {
  if (groupId === "learncode") {
    return `${label}: coding, interview, internship, project and placement resources collected for JNTUH B.Tech CSE & AIML students, linked to the original source documents.`;
  }
  if (yearName) {
    return `${label} study material for JNTUH B.Tech ${yearName} (R22): notes, question sets and documents, each linked to its original Google Drive file.`;
  }
  return `${label}: JNTUH B.Tech study material linked to its original Google Drive documents.`;
}

/**
 * Resolve full SEO data for a route descriptor.
 * Descriptor shape: { kind, path, yearId?, yearName?, label?, groupId?, categoryId? }
 */
export function seoFor(desc) {
  const path = normalizePath(desc.path);
  const canonical = canonicalUrl(path);
  let title;
  let description;
  let robots = DEFAULT_ROBOTS;
  let jsonLd = null;

  switch (desc.kind) {
    case "home":
      title = HOME_TITLE;
      description = HOME_DESCRIPTION;
      jsonLd = websiteJsonLd();
      break;
    case "years":
      title = "JNTUH B.Tech Notes by Year (R22) | JNTUH Notes";
      description =
        "Select your JNTUH B.Tech year to browse CSE & AIML subjects, notes, question sets and previous question papers for the R22 regulation.";
      break;
    case "year":
      title = `JNTUH B.Tech ${desc.yearName} Notes | Subjects & Study Material`;
      description = `All JNTUH B.Tech ${desc.yearName} CSE & AIML subjects for the R22 regulation, with notes, question sets and previous question papers linked to their original documents.`;
      break;
    case "subject":
      title = subjectTitle(desc.label, desc.groupId, desc.yearName);
      description = subjectDescription(desc.label, desc.groupId, desc.yearName);
      break;
    case "questions": {
      const cat = QUESTION_CATEGORY_META[desc.categoryId];
      if (!cat) {
        robots = NOINDEX_ROBOTS;
        title = "Question Sets | JNTUH Notes";
        description =
          "JNTUH question sets organised by year and subject, linked to their original documents.";
      } else {
        title = cat.title;
        description = cat.description;
      }
      break;
    }
    case "code":
      title = "Coding & Placement Resources | JNTUH Notes";
      description =
        "Coding notes, roadmaps, interview preparation, internship, project and placement resources collected for JNTUH B.Tech CSE & AIML students.";
      break;
    case "search":
      title = "Search JNTUH Study Material | JNTUH Notes";
      description =
        "Search the JNTUH Notes library by subject, unit, topic or file name, then open the original document. Results are grouped by year and category.";
      robots = NOINDEX_ROBOTS;
      break;
    case "sitemaps":
      title = "Site Map | JNTUH Notes";
      description =
        "Browse the full JNTUH Notes site map: academic years, CSE & AIML subjects, guaranteed and short questions, syllabus, coding resources and legal pages.";
      break;
    case "privacy":
      title = "Privacy Policy | JNTUH Notes";
      description =
        "How JNTUH Notes handles local storage, third-party services and external document links.";
      break;
    case "signin":
      title = "Sign In | JNTUH Notes";
      description =
        "Sign in to your JNTUH Notes account to manage your profile and study tools.";
      robots = NOINDEX_ROBOTS;
      break;
    case "signup":
      title = "Create Account | JNTUH Notes";
      description =
        "Create a free JNTUH Notes account. Reading and downloading study material never requires an account.";
      robots = NOINDEX_ROBOTS;
      break;
    case "forgot":
      title = "Reset Password | JNTUH Notes";
      description =
        "Request a password reset link for your JNTUH Notes account.";
      robots = NOINDEX_ROBOTS;
      break;
    case "account":
      title = "Your Account | JNTUH Notes";
      description = "Manage the details of your JNTUH Notes account.";
      robots = "noindex, nofollow";
      break;
    case "terms":
      title = "Terms & Conditions | JNTUH Notes";
      description =
        "The terms and conditions that apply to using the JNTUH Notes study-material website.";
      break;
    default:
      title = "Page Not Found | JNTUH Notes";
      description =
        "The page you requested does not exist. Browse JNTUH B.Tech CSE & AIML notes, question sets and study material instead.";
      robots = NOINDEX_ROBOTS;
      break;
  }

  if (!jsonLd && desc.kind !== "notfound") {
    const crumbs = buildCrumbs(desc);
    if (crumbs.length > 1) jsonLd = breadcrumbJsonLd(crumbs);
  }

  return {
    title,
    description,
    canonical,
    robots,
    jsonLd,
    siteName: SITE_NAME,
    ogType: "website",
    ogImage: ogImageUrl(),
    ogImageWidth: OG_IMAGE_WIDTH,
    ogImageHeight: OG_IMAGE_HEIGHT,
  };
}

/**
 * Breadcrumb trail for a descriptor. Returns [{ label, path, current }].
 * Shared by the visible Breadcrumbs component and the JSON-LD above.
 */
export function buildCrumbs(desc) {
  const home = { label: "Home", path: "/" };
  switch (desc.kind) {
    case "home":
      return [{ ...home, current: true }];
    case "years":
      return [home, { label: "Select Year", path: "/years", current: true }];
    case "code":
      return [home, { label: "Learn Code", path: "/code", current: true }];
    case "search":
      return [home, { label: "Search", path: "/search", current: true }];
    case "sitemaps":
      return [home, { label: "Site Map", path: "/sitemaps", current: true }];
    case "questions": {
      const cat = QUESTION_CATEGORY_META[desc.categoryId];
      return [
        home,
        { label: cat ? cat.crumb : "Questions", path: desc.path, current: true },
      ];
    }
    case "year":
      return [
        home,
        { label: desc.yearName || "Year", path: desc.path, current: true },
      ];
    case "subject": {
      const trail = [home];
      if (/^year\d$/.test(desc.groupId)) {
        trail.push({
          label: desc.yearName || "Subjects",
          path: `/year/${desc.yearId}`,
        });
      } else if (desc.groupId === "learncode") {
        trail.push({ label: "Learn Code", path: "/code" });
      } else {
        trail.push({ label: "Select Year", path: "/years" });
      }
      trail.push({
        label: desc.label || "Subject",
        path: desc.path,
        current: true,
      });
      return trail;
    }
    case "privacy":
      return [
        home,
        { label: "Privacy Policy", path: "/privacy-policy", current: true },
      ];
    case "terms":
      return [
        home,
        { label: "Terms & Conditions", path: "/terms-and-conditions", current: true },
      ];
    case "signin":
      return [home, { label: "Sign in", path: "/signin", current: true }];
    case "signup":
      return [home, { label: "Create account", path: "/signup", current: true }];
    case "forgot":
      return [
        home,
        { label: "Reset password", path: "/forgot-password", current: true },
      ];
    case "account":
      return [home, { label: "Your account", path: "/account", current: true }];
    default:
      return [home, { label: "Page not found", path: desc.path, current: true }];
  }
}
