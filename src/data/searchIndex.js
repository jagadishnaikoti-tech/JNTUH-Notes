// Builds a flat, searchable index of every subject and every document that is
// reachable from the reference website. Generated from src/data/resources.json
// (the crawled Google Drive inventory) at build time.

import resources from "./resources.json";
import { YEARS } from "./site.js";

export const SUBJECT_INDEX = YEARS.flatMap((year) =>
  year.subjects
    .filter((s) => !s.disabled && s.folderId)
    .map((s) => ({
      type: "subject",
      label: s.label,
      yearName: year.name,
      yearId: year.id,
      folderId: s.folderId,
      resource: (resources.groups[`year${year.id}`] || []).find(
        (r) => r.folderId === s.folderId
      ),
    }))
);

export const FILE_INDEX = [];
for (const [group, items] of Object.entries(resources.groups)) {
  for (const item of items) {
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === "folder") {
          walk(node.children);
        } else {
          FILE_INDEX.push({
            type: "file",
            title: node.title,
            path: node.path,
            fileId: node.fileId,
            url: node.url,
            downloadUrl: node.downloadUrl,
            ext: node.ext,
            bytes: node.bytes,
            group,
            subject: item.label,
            subjectFolderId: item.folderId,
          });
        }
      }
    };
    walk(item.files);
  }
}

export const SEARCH_TOTALS = {
  subjects: SUBJECT_INDEX.length,
  files: FILE_INDEX.length,
};
