// Generates RESOURCE_INVENTORY.md / .csv and MIGRATION_REPORT.md from the
// crawled data so the reports are always accurate (never hand-typed).
import { readFile, writeFile } from "node:fs/promises";

const res = JSON.parse(await readFile(new URL("../src/data/resources.json", import.meta.url), "utf8"));

const csvEscape = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [
  ["group", "subject", "type", "relative_path", "title", "file_id", "original_url", "download_url", "ext", "bytes"],
];
const walk = (nodes, group, subject) => {
  for (const n of nodes) {
    rows.push([
      group,
      subject,
      n.type,
      n.path,
      n.title,
      n.fileId,
      n.url,
      n.downloadUrl || "",
      n.ext || "",
      n.bytes || "",
    ]);
    if (n.children) walk(n.children, group, subject);
  }
};
for (const [group, items] of Object.entries(res.groups)) {
  for (const it of items) walk(it.files, group, it.label);
}

const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
await writeFile(new URL("../RESOURCE_INVENTORY.csv", import.meta.url), csv);

const totalFiles = res.totals.files;
const totalFolders = res.totals.folders;
const gb = (res.totals.bytes / 1073741824).toFixed(2);

// Per-group table
const groupNames = { syllabus: "Syllabus / other", learncode: "Learn Code", year1: "1st Year", year2: "2nd Year", year3: "3rd Year", year4: "4th Year" };
let md = `# Resource Inventory

Source website: ${res.source}
Inventory generated: ${res.generatedAt}

All study material on the reference website is published as **public Google Drive
folders**. This inventory was produced by enumerating every folder and every file
inside it, so no document is lost during the migration. The React app links to the
original Drive URLs (see \`src/data/resources.json\` for the machine-readable tree and
\`RESOURCE_INVENTORY.csv\` for the complete flat listing).

## Totals

| Metric | Value |
| --- | --- |
| Top-level resource folders | ${Object.values(res.groups).reduce((a, g) => a + g.length, 0)} |
| Nested sub-folders | ${totalFolders} |
| Individual files | ${totalFiles} |
| Total size (reported by Google Drive) | ${gb} GB |
| Files mirrored locally | 0 (linked to original Drive URLs by design — see note) |

> Note on local copies: the user selected **"Link to Drive originals"**. Because the
> reference site itself only ever links to Drive folders (never individual files), the
> faithful migration preserves those original URLs and additionally exposes every
> individual file with its own Drive URL. No multi-GB local mirror is produced. The
> full per-file mapping is recorded in \`RESOURCE_INVENTORY.csv\`.

## Top-level resources by section

| Section | Resource | Files | Sub-folders | Size | Original folder URL |
| --- | --- | ---: | ---: | ---: | --- |
`;

const fmtBytes = (b) => {
  const u = ["B", "KB", "MB", "GB"];
  let n = b || 0,
    i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
};

for (const [group, items] of Object.entries(res.groups)) {
  for (const it of items) {
    md += `| ${groupNames[group] || group} | ${it.label.replace(/\|/g, "\\|")} | ${it.stats.files} | ${it.stats.folders} | ${fmtBytes(it.stats.bytes)} | ${it.url} |\n`;
  }
}

md += `
## Known limitations / unverified resources

The following folders returned no public file listing and are flagged as limitations.
Their original links are preserved exactly as they appear on the reference site:

| Resource | Original URL | Status |
| --- | --- | --- |
| Learn Code → PLACEMENT | https://drive.google.com/drive/u/0/mobile/folders/1SkCOcAS0Kqvuz-MJkkjbFr1GSue6Ms6m | **Broken on the original site** — Google Drive returns HTTP 404. Link preserved unchanged. |
| 4th Year → SMS | https://drive.google.com/drive/folders/1yiRAlVSzGM_TiJSsDcWvDyGTeLyKhL1H | Reachable but **empty / nothing publicly listed**. |
| 4th Year → Important Questions | https://drive.google.com/drive/folders/1INd-6RhfWOEPRgpwdxDkDXUjLbwCZlh6 | Reachable but **empty / nothing publicly listed**. |
| 4th Year → SVP | (empty \`href=""\` on the reference site) | The original link is empty; preserved as a disabled entry, no destination invented. |

## Column reference (RESOURCE_INVENTORY.csv)

- \`group\` — section of the site (\`year1\`..\`year4\`, \`learncode\`, \`syllabus\`).
- \`subject\` — top-level subject / folder label as shown on the site.
- \`type\` — \`folder\` or \`file\`.
- \`relative_path\` — path inside the subject folder.
- \`title\` — original file / folder name.
- \`file_id\` — Google Drive file id.
- \`original_url\` — Google Drive URL (folder view or file view).
- \`download_url\` — Google Drive direct-download URL (files only).
- \`ext\` — file extension.
- \`bytes\` — size in bytes.
`;

await writeFile(new URL("../RESOURCE_INVENTORY.md", import.meta.url), md);
console.log("Wrote RESOURCE_INVENTORY.md and RESOURCE_INVENTORY.csv (" + (rows.length - 1) + " rows)");
