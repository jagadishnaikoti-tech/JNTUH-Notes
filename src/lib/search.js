// ===========================================================================
// Search engine for the JNTUH Notes document library.
//
// Pure, framework-free logic kept separate from presentation components. It is
// built directly on the existing data sources (src/data/resources.json and the
// YEARS list in src/data/site.js) so there is a single source of truth and no
// duplicated document records.
//
// What it searches (all from the real data):
//   - subject / folder names            - document (PDF, DOCX, PPT...) titles
//   - year names ("1st Year"...)        - full Drive paths
//   - file extensions / document type   - subject + folder context
//
// Matching is case-insensitive, whitespace-tolerant, supports partial words,
// multi-word (AND) queries and formatting variants such as "unit-2", "unit 2"
// and "unit2" (a compact, punctuation-insensitive pass).
// ===========================================================================

import resources from "../data/resources.json";
import { YEARS } from "../data/site.js";

// ---- Document-type model --------------------------------------------------
export const CATEGORY_LABELS = {
  all: "All types",
  subject: "Subjects",
  pdf: "PDF",
  documents: "Documents",
  slides: "Slides",
  media: "Media",
  other: "Other",
};

export const CATEGORY_ORDER = [
  "pdf",
  "documents",
  "slides",
  "media",
  "other",
];

const EXT_CATEGORY = {
  pdf: "pdf",
  doc: "documents",
  docx: "documents",
  rtf: "documents",
  txt: "documents",
  md: "documents",
  ppt: "slides",
  pptx: "slides",
  jpg: "media",
  jpeg: "media",
  png: "media",
  gif: "media",
  webp: "media",
  mp4: "media",
  mp3: "media",
  zip: "other",
  rar: "other",
  cpp: "other",
  h: "other",
  html: "other",
  htm: "other",
};

// ---- Text normalisation ---------------------------------------------------
const ORDINAL_FIXES = [
  [/\bfirst\b/g, "1st"],
  [/\bsecond\b/g, "2nd"],
  [/\bthird\b/g, "3rd"],
  [/\bfourth\b/g, "4th"],
];

/** Lower-case, strip accents/punctuation, collapse whitespace. */
function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compactText = (value) => normalizeText(value).replace(/\s+/g, "");

/** Query-side normalisation (adds ordinal aliases: first -> 1st). */
function normalizeQuery(value) {
  let out = normalizeText(value);
  for (const [re, replacement] of ORDINAL_FIXES) out = out.replace(re, replacement);
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Index construction ---------------------------------------------------
const yearNameById = new Map(YEARS.map((y) => [String(y.id), y.name]));
const GROUP_CONTEXT = { learncode: "Learn Code", syllabus: "Syllabus" };

function makeFields({ title, path, subject, year, ext }) {
  const fields = {
    title: normalizeText(title),
    path: normalizeText(path),
    subject: normalizeText(subject),
    year: normalizeText(year),
    ext: normalizeText(ext),
  };
  const norm = [fields.title, fields.path, fields.subject, fields.year, fields.ext]
    .filter(Boolean)
    .join(" ");
  return { fields, norm, compact: norm.replace(/ /g, "") };
}

export const SUBJECT_RECORDS = [];
export const FILE_RECORDS = [];

{
  const seenFolders = new Set();
  const seenFiles = new Set();

  for (const [groupId, items] of Object.entries(resources.groups)) {
    const yearMatch = /^year(\d)$/.exec(groupId);
    const yearId = yearMatch ? Number(yearMatch[1]) : null;
    const yearName = yearId
      ? yearNameById.get(String(yearId)) || null
      : GROUP_CONTEXT[groupId] || null;

    for (const item of items) {
      if (!item || !item.folderId) continue;

      // Subjects / folders (one record per unique folder - BEFA is linked from
      // two years, so de-duplicate by folderId).
      if (!seenFolders.has(item.folderId)) {
        seenFolders.add(item.folderId);
        SUBJECT_RECORDS.push({
          kind: "subject",
          id: `subject:${groupId}:${item.folderId}`,
          title: item.label,
          subject: item.label,
          path: null,
          ext: "",
          category: "subject",
          count: item.stats?.files ?? 0,
          year: yearName,
          yearId,
          context: yearName,
          groupId,
          folderId: item.folderId,
          to: `/subject/${groupId}/${item.folderId}`,
          url: item.url,
          ...makeFields({
            title: item.label,
            path: item.label,
            subject: item.label,
            year: yearName,
            ext: "subject folder",
          }),
        });
      }

      // Every file inside the folder tree.
      const walk = (nodes) => {
        for (const node of nodes) {
          if (node.type === "folder") {
            walk(node.children);
            continue;
          }
          if (!node.fileId || seenFiles.has(node.fileId)) continue;
          seenFiles.add(node.fileId);
          const ext = (node.ext || "").toLowerCase();
          const category = EXT_CATEGORY[ext] || "other";
          FILE_RECORDS.push({
            kind: "file",
            id: `file:${node.fileId}`,
            title: node.title,
            path: node.path,
            ext,
            category,
            subject: item.label,
            year: yearName,
            yearId,
            context: yearName,
            groupId,
            folderId: item.folderId,
            to: `/subject/${groupId}/${item.folderId}`,
            url: node.url,
            downloadUrl: node.downloadUrl,
            fileId: node.fileId,
            bytes: node.bytes,
            ...makeFields({
              title: node.title,
              path: node.path,
              subject: item.label,
              year: yearName,
              ext: `${ext} ${CATEGORY_LABELS[category] || ""}`,
            }),
          });
        }
      };
      walk(item.files || []);
    }
  }
}

export const SEARCH_TOTALS = {
  subjects: SUBJECT_RECORDS.length,
  files: FILE_RECORDS.length,
};

// ---- Scoring --------------------------------------------------------------
function scoreRecord(record, phrase, tokens, phraseCompact) {
  let score = 0;

  // Whole-phrase boost (punctuation-insensitive) then plain phrase.
  if (phraseCompact && record.compact.includes(phraseCompact)) score += 140;
  if (phrase && record.norm.includes(phrase)) score += 100;

  const f = record.fields;
  const paddedTitle = ` ${f.title} `;
  const paddedSubject = ` ${f.subject} `;

  let matchedAll = true;
  for (const token of tokens) {
    let hit = false;

    if (f.title.includes(token)) {
      score += 26;
      hit = true;
      if (paddedTitle.includes(` ${token} `)) score += 14; // exact word
    }
    if (f.subject.includes(token)) {
      score += 16;
      hit = true;
      if (paddedSubject.includes(` ${token} `)) score += 8;
    }
    if (f.year.includes(token)) {
      score += 12;
      hit = true;
    }
    if (f.path.includes(token)) {
      score += 10;
      hit = true;
    }
    if (f.ext && (f.ext === token || f.ext.startsWith(token))) {
      score += 8;
      hit = true;
    }

    if (!hit) matchedAll = false;
  }

  if (!matchedAll) return 0;
  return score;
}

function buildFacets(scoredSubjects, scoredFiles) {
  const types = new Set();
  const years = new Map();
  const subjects = new Set();

  for (const { record } of scoredSubjects) {
    types.add("subject");
    if (record.yearId) years.set(String(record.yearId), record.year);
    subjects.add(record.subject);
  }
  for (const { record } of scoredFiles) {
    types.add(record.category);
    if (record.yearId) years.set(String(record.yearId), record.year);
    subjects.add(record.subject);
  }

  return {
    types: [
      "all",
      ...CATEGORY_ORDER.filter((c) => types.has(c)),
      ...(types.has("subject") ? ["subject"] : []),
    ],
    years: [...years.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, name]) => ({ id, name })),
    subjects: [...subjects].sort((a, b) => a.localeCompare(b)),
  };
}

const EMPTY_FACETS = { types: ["all"], years: [], subjects: [] };

/**
 * Run a search.
 *
 * @param {string} rawQuery
 * @param {object} [options]
 * @param {string} [options.type]    "all" | "subject" | "pdf" | "documents" | ...
 * @param {string} [options.yearId]  "all" | "1".."4"
 * @param {string} [options.subject] "all" | a subject label
 * @param {"relevance"|"title"} [options.sort]
 * @param {number} [options.limit]
 */
export function searchResources(rawQuery, options = {}) {
  const {
    type = "all",
    yearId = "all",
    subject = "all",
    sort = "relevance",
    limit = 300,
  } = options;

  const phrase = normalizeQuery(rawQuery);
  const tokens = phrase ? phrase.split(" ").filter(Boolean) : [];
  const phraseCompact = phrase.replace(/ /g, "");
  const highlightTokens = String(rawQuery ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) {
    return {
      empty: true,
      subjects: [],
      files: [],
      all: [],
      total: 0,
      facets: EMPTY_FACETS,
      truncated: false,
      highlightTokens: [],
      query: rawQuery,
      filters: { type, yearId, subject, sort },
    };
  }

  const scoredSubjects = [];
  const scoredFiles = [];
  for (const record of SUBJECT_RECORDS) {
    const score = scoreRecord(record, phrase, tokens, phraseCompact);
    if (score > 0) scoredSubjects.push({ record, score });
  }
  for (const record of FILE_RECORDS) {
    const score = scoreRecord(record, phrase, tokens, phraseCompact);
    if (score > 0) scoredFiles.push({ record, score });
  }

  const facets = buildFacets(scoredSubjects, scoredFiles);

  const yearKey = String(yearId);
  const matchFilters = ({ record }) => {
    if (type !== "all" && record.category !== type) return false;
    if (yearId !== "all" && String(record.yearId) !== yearKey) return false;
    if (subject !== "all" && record.subject !== subject) return false;
    return true;
  };

  let subjects = scoredSubjects.filter(matchFilters);
  let files = scoredFiles.filter(matchFilters);

  const byTitle = (a, b) =>
    a.record.title.localeCompare(b.record.title) || b.score - a.score;
  const byRelevance = (a, b) =>
    b.score - a.score ||
    a.record.title.length - b.record.title.length ||
    a.record.title.localeCompare(b.record.title);

  const comparator = sort === "title" ? byTitle : byRelevance;
  subjects = subjects.sort(comparator);
  files = files.sort(comparator);

  const combined = [...subjects, ...files];
  const truncated = combined.length > limit;
  const visible = truncated ? combined.slice(0, limit) : combined;

  return {
    empty: false,
    subjects: visible.filter((x) => x.record.kind === "subject").map((x) => x.record),
    files: visible.filter((x) => x.record.kind === "file").map((x) => x.record),
    all: visible.map((x) => x.record),
    total: combined.length,
    facets,
    truncated,
    highlightTokens,
    query: rawQuery,
    filters: { type, yearId, subject, sort },
  };
}

// ---- Highlighting (safe: returns segments, never raw HTML) ----------------
/**
 * Split `text` into [{ text, match }] segments for the given query tokens.
 * Callers render matches as <mark> - no dangerouslySetInnerHTML involved.
 */
export function highlightParts(text, tokens) {
  const source = String(text ?? "");
  const clean = (tokens || []).map((t) => t.trim()).filter(Boolean);
  if (!source || clean.length === 0) return [{ text: source, match: false }];

  const pattern = [...clean]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");

  const parts = source.split(new RegExp(`(${pattern})`, "ig"));
  return parts
    .map((text, i) => ({ text, match: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}

// ---- Small shared formatting helper --------------------------------------
export function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
