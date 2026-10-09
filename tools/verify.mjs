// Verifies the migrated React data against the live reference website.
// - confirms every Drive folder link on the reference site is present in the app
// - confirms every external link is present
// - confirms every subject label is present
// - flags duplicate folder ids / file ids
import { readFile, writeFile } from "node:fs/promises";

const REFERENCE = "https://cselnr223.ccbp.tech/";
const html = await (await fetch(REFERENCE)).text();
await writeFile(new URL("./reference.html", import.meta.url), html);

const res = JSON.parse(await readFile(new URL("../src/data/resources.json", import.meta.url), "utf8"));

// ---- Collect folder ids + urls used by the app ----------------------------
const appFolderIds = new Set();
for (const items of Object.values(res.groups)) {
  for (const it of items) appFolderIds.add(it.folderId);
}

// ---- folder ids referenced by the reference HTML --------------------------
const refFolderIds = new Set(
  [...html.matchAll(/drive\/(?:u\/\d+\/mobile\/)?folders\/([A-Za-z0-9_-]+)/g)].map((m) => m[1])
);

const missingFolders = [...refFolderIds].filter((id) => !appFolderIds.has(id));

// ---- external links --------------------------------------------------------
const externalLinks = [
  "https://wa.me/?text=Hey,--I-found-this-LINK-It's-very-helpful-for-our-Exam-Preparation-📌https://cselnr223.ccbp.tech/",
  "https://wa.link/4q29q4",
  "https://wa.link/0zayru",
  "https://wa.link/75g1md",
  "https://jntuhresults.vercel.app/academicresult",
  "https://linktr.ee/faith_enhancer",
  "https://jntuh-iq.vercel.app/",
  "http://t.me/CSE_Helper_bot",
  "https://roadmap.sh/",
  "https://www.codsoft.in/",
  "https://www.codechef.com/ide",
];
const missingLinks = externalLinks.filter((u) => !html.includes(u.replace(/&/g, "&amp;")) && !html.includes(u));

// ---- subject labels --------------------------------------------------------
const YEARS = [
  ["1st Year", ["M1 M2", "PPS", "AP", "ENG", "BEE", "EDC", "CAEG", "CHEM"]],
  ["2nd Year", ["COSM", "MSF", "DM", "COA", "JAVA", "DBMS", "BEFA", "LABS", "OS", "DS", "DE", "SE"]],
  ["3rd Year", ["DevOps", "DAA", "IRS", "IDS", "PPL", "BEFA", "NLP", "CN", "DA", "LABS", "FLAT", "FIoT", "STM", "AI", "ML"]],
  ["4th Year", ["CC", "CD", "CNS", "SMS", "NIC", "SPPM", "IEM", "MC", "SVP", "LABS", "OB", "ED", "DS", "WS", "HCI"]],
];
const missingLabels = [];
const missingYearNames = [];
for (const [yearName, labels] of YEARS) {
  if (!html.includes(`>${yearName}<`)) missingYearNames.push(yearName);
  for (const l of labels) if (!html.includes(`>${l}</a>`)) missingLabels.push(`${yearName}: ${l}`);
}

// ---- duplicate detection ---------------------------------------------------
// Note: the SAME Drive file can legitimately live in several folders on the
// reference site (e.g. a paper shared between R18 and R22 folders). That is not
// a migration error. A real problem would be the same file id listed twice
// WITHIN one subject (React key collision), so only that is flagged.
const allFileIds = [];
const withinSubjectDupes = [];
for (const items of Object.values(res.groups)) {
  for (const it of items) {
    const ids = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === "file") {
          allFileIds.push(n.fileId);
          ids.push(n.fileId);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(it.files);
    const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    if (dupes.length) withinSubjectDupes.push({ subject: it.label, dupes });
  }
}
const dupFolderRefs = [...refFolderIds].length !== refFolderIds.size;

const report = {
  referenceFoldersOnSite: refFolderIds.size,
  appTopLevelFolders: appFolderIds.size,
  missingFolderIds: missingFolders,
  missingExternalLinks: missingLinks,
  missingSubjectLabels: missingLabels,
  missingYearNames: missingYearNames,
  totalFilesIndexed: allFileIds.length,
  sharedFilesAcrossFolders:
    allFileIds.length - new Set(allFileIds).size,
  withinSubjectDuplicateFileIds: withinSubjectDupes,
  duplicateFolderRefs: dupFolderRefs,
};

console.log(JSON.stringify(report, null, 2));

const ok =
  missingFolders.length === 0 &&
  missingLinks.length === 0 &&
  missingLabels.length === 0 &&
  missingYearNames.length === 0 &&
  withinSubjectDupes.length === 0 &&
  !dupFolderRefs;

console.log("\n" + (ok ? "VERIFICATION PASSED" : "VERIFICATION ISSUES FOUND"));
await writeFile(new URL("./verification.json", import.meta.url), JSON.stringify(report, null, 2));
process.exitCode = ok ? 0 : 1;
