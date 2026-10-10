// ---------------------------------------------------------------------------
// Question-set index (Guaranteed Questions + Short Questions).
//
// Nothing in this module is invented: every entry is a real document crawled
// from src/data/resources.json (year groups only) and mapped back to its
// original Google Drive file URL, its download URL and the existing in-app
// subject-folder route. Files are classified purely from their real titles.
// ---------------------------------------------------------------------------

import resources from "./resources.json";
import { LINKS, YEARS, getResource } from "./site.js";

// ---- Classification patterns (used on file titles) ------------------------
// Short-answer / quick-revision question sets.
const SHORT_PATTERNS =
  /(\b2\s*marks?\b|\bshort\s*(?:question|answer|q)?\b|one\s*mark\b|two\s*marks?\b|objective\b|mcq\b)/i;

// Important / guaranteed question material.
const GUARANTEED_PATTERNS =
  /(\bimp\b|important|guarante|\bq&a\b|\bq(?:uestion|['’]?n?s?|\.?s?)\b|question\s*bank|\bbank\b)/i;

// Explicitly not question *sets* (previous/model/sample papers etc.).
const EXCLUDED_PATTERNS =
  /(previous|model|sample|revaluation|supply|old\s+question\s*papers?|question\s*papers?)/i;

// ---- Build the index once at module load ----------------------------------
const INDEX = { guaranteed: [], short: [] };
const seenTitle = { guaranteed: new Set(), short: new Set() };

export function classifyTitle(title) {
  if (EXCLUDED_PATTERNS.test(title)) return null;
  if (SHORT_PATTERNS.test(title)) return "short";
  if (GUARANTEED_PATTERNS.test(title)) return "guaranteed";
  return null;
}

function unitLabel(title) {
  const match = title.match(/unit\s*[-_:.# ]*([ivx]+|\d+)/i);
  if (!match) return null;
  const norm = /^[ivx]+$/i.test(match[1]) ? match[1].toUpperCase() : match[1];
  return `UNIT-${norm}`;
}

function subjectOf(path, groupId, owningItem) {
  const segments = String(path || "")
    .split("/")
    .filter(Boolean);
  const first = segments[0] || owningItem.label;
  const subject = getResource(groupId, first);
  if (subject) {
    return { subject: subject.label, subjectFolderId: subject.folderId || "" };
  }
  return { subject: first, subjectFolderId: owningItem.folderId || "" };
}

function walkFolder(node, groupId, year, owningItem) {
  // Top-level group items store their children under `files`, nested folders
  // under `children`. Read whichever the node actually has.
  for (const child of node.files || node.children || []) {
    if (child.type === "folder") {
      if (child.children && child.children.length) {
        walkFolder(child, groupId, year, owningItem);
      }
      continue;
    }
    if (child.type !== "file" || !child.title) continue;

    const category = classifyTitle(child.title);
    if (!category) continue;

    // De-duplicate identical real files that are republished under more than
    // one folder (e.g. "Important Questions" shares the same PDFs as subject
    // folders). Normalised title + year keeps listings clean.
    const key = child.title.toLowerCase().replace(/\s+/g, " ").trim();
    const dedupeKey = `${year.id}::${key}`;
    if (seenTitle[category].has(dedupeKey)) continue;
    seenTitle[category].add(dedupeKey);

    const { subject, subjectFolderId } = subjectOf(
      child.path,
      groupId,
      owningItem
    );

    INDEX[category].push({
      id: `${category}:${year.id}:${key}`,
      category,
      yearId: year.id,
      yearName: year.name,
      yearPath: `/year/${year.id}`,
      subject,
      subjectFolderId,
      subjectFolderPath: subjectFolderId
        ? `/subject/${groupId}/${subjectFolderId}`
        : null,
      title: child.title,
      ext: child.ext || null,
      fileId: child.fileId,
      url: child.url || "",
      downloadUrl: child.downloadUrl || "",
      path: child.path || "",
      bytes: child.bytes || 0,
      unit: unitLabel(child.title),
    });
  }
}

for (const year of YEARS) {
  const groupId = `year${year.id}`;
  const groupItems = resources.groups[groupId] || [];
  for (const item of groupItems) {
    walkFolder(item, groupId, year, item);
  }
}

// ---- Public helpers ---------------------------------------------------------

export const QUESTION_CATEGORIES = [
  {
    id: "guaranteed",
    title: "Guaranteed Questions",
    to: "/questions/guaranteed",
    description:
      "Access curated question sets intended to help you prioritize exam preparation.",
    cta: "Explore Guaranteed Questions",
  },
  {
    id: "short",
    title: "Short Questions",
    to: "/questions/short",
    description:
      "Review concise question sets for quick revision and focused practice.",
    cta: "Explore Short Questions",
  },
];

export const getQuestionCategory = (id) =>
  QUESTION_CATEGORIES.find((c) => c.id === id) || null;

/** All question sets for a category, sorted by year -> subject -> title. */
export const getQuestionSets = (categoryId) =>
  (INDEX[categoryId] || [])
    .slice()
    .sort(
      (a, b) =>
        a.yearId - b.yearId ||
        String(a.subject).localeCompare(String(b.subject)) ||
        a.title.localeCompare(b.title)
    );

/** Real academic years (in order) that have content in a category. */
export const getQuestionYears = (categoryId) => {
  const sets = INDEX[categoryId] || [];
  return YEARS.map((year) => ({
    year,
    count: sets.filter((s) => s.yearId === year.id).length,
  })).filter((row) => row.count > 0);
};

export const countQuestionSets = (categoryId) => (INDEX[categoryId] || []).length;

/**
 * The original "GUARNTEE QNS" destination from the reference site — a live
 * external JNTUH-IQ question tool. Real link, kept verbatim.
 */
export const GUARANTEE_QNS_EXTERNAL = LINKS.guaranteeQns;