// ---------------------------------------------------------------------------
// Per-route document metadata (title + meta description).
//
// Kept in one place so every route gets an accurate, descriptive <title> and
// <meta name="description"> for SEO and browser history, without duplicating
// strings across pages. Descriptions describe the real content of each route.
// ---------------------------------------------------------------------------

import { getYear } from "../data/site.js";

const BASE_DESCRIPTION =
  "JNTUH Notes: free B.Tech CSE & AIML study material for the R22 regulation, including subject notes, important and guaranteed questions, short questions and previous question papers, each linked to its original document.";

const TITLES = {
  "/years": "Select Year | JNTUH Notes",
  "/code": "Learn Code | JNTUH Notes",
  "/search": "Search Study Material | JNTUH Notes",
  "/questions/guaranteed": "Guaranteed Questions | JNTUH Notes",
  "/questions/short": "Short Questions | JNTUH Notes",
  "/privacy-policy": "Privacy Policy | JNTUH Notes",
  "/terms-and-conditions": "Terms & Conditions | JNTUH Notes",
};

const DESCRIPTIONS = {
  "/years":
    "Choose your JNTUH B.Tech year to browse subjects, notes and study material for the R22 regulation.",
  "/code":
    "Coding notes, roadmaps, interview preparation and placement resources collected for JNTUH B.Tech students.",
  "/search":
    "Search JNTUH Notes by subject, unit, topic or file name across the study-material library.",
  "/questions/guaranteed":
    "Guaranteed and important question sets organised by year and subject, linked to their original documents.",
  "/questions/short":
    "Short-answer and two-mark question sets for quick revision, organised by year and subject.",
  "/privacy-policy":
    "How JNTUH Notes handles local storage, third-party services and external document links.",
  "/terms-and-conditions":
    "The terms and conditions that apply to using the JNTUH Notes study-material website.",
};

const HOME_TITLE = "JNTUH Notes | B.Tech CSE & AIML Study Material";

/** Resolve { title, description } for a given pathname. */
export function getRouteMeta(pathname) {
  if (pathname === "/") {
    return { title: HOME_TITLE, description: BASE_DESCRIPTION };
  }

  const yearMatch = /^\/year\/([^/]+)/.exec(pathname);
  if (yearMatch) {
    const year = getYear(yearMatch[1]);
    const label = year ? year.name : "Subjects";
    return {
      title: `${label} | JNTUH Notes`,
      description: `JNTUH B.Tech ${label} subjects, notes and study material (R22 regulation).`,
    };
  }

  if (pathname.startsWith("/subject/")) {
    return {
      title: "Subject Study Material | JNTUH Notes",
      description:
        "Subject study material: notes, question sets and documents, each linked to its original Google Drive file.",
    };
  }

  if (TITLES[pathname]) {
    return { title: TITLES[pathname], description: DESCRIPTIONS[pathname] };
  }

  return {
    title: "Page Not Found | JNTUH Notes",
    description: BASE_DESCRIPTION,
  };
}

export { BASE_DESCRIPTION, HOME_TITLE };
