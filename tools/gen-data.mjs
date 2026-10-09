// Generates src/data/resources.json from the crawled Drive inventory.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const inv = JSON.parse(await readFile(new URL("./drive-inventory.json", import.meta.url), "utf8"));
let sizes = [];
try {
  sizes = JSON.parse(await readFile(new URL("./file-sizes.json", import.meta.url), "utf8"));
} catch {
  sizes = [];
}
const sizeById = new Map(sizes.map((s) => [s.id, s.bytes]));

const fileUrl = (id) => `https://drive.google.com/file/d/${id}/view`;
const downloadUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;
const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;

function ext(name) {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function flatten(nodes, base) {
  const out = [];
  for (const n of nodes || []) {
    const rel = [...base, n.title];
    if (n.isFolder) {
      out.push({
        type: "folder",
        title: n.title,
        fileId: n.id,
        url: folderUrl(n.id),
        path: rel.join("/"),
        children: flatten(n.children, rel),
      });
    } else {
      out.push({
        type: "file",
        title: n.title,
        fileId: n.id,
        url: fileUrl(n.id),
        downloadUrl: downloadUrl(n.id),
        path: rel.join("/"),
        ext: ext(n.title),
        bytes: sizeById.get(n.id) || 0,
      });
    }
  }
  return out;
}

function countFiles(nodes) {
  let folders = 0,
    files = 0,
    bytes = 0;
  for (const n of nodes || []) {
    if (n.type === "folder") {
      folders++;
      const s = countFiles(n.children);
      folders += s.folders;
      files += s.files;
      bytes += s.bytes;
    } else {
      files++;
      bytes += n.bytes || 0;
    }
  }
  return { folders, files, bytes };
}

const out = {
  generatedAt: new Date().toISOString(),
  source: "https://cselnr223.ccbp.tech/",
  groups: {},
};

for (const [group, items] of Object.entries(inv.groups)) {
  out.groups[group] = items.map((it) => {
    const children = flatten(it.tree ? it.tree.children : [], [it.label]);
    const stats = countFiles(children);
    return {
      label: it.label,
      folderId: it.id,
      url: folderUrl(it.id),
      stats,
      files: children,
    };
  });
}

// Site-wide totals
let totalFiles = 0,
  totalFolders = 0,
  totalBytes = 0;
for (const items of Object.values(out.groups)) {
  for (const it of items) {
    totalFiles += it.stats.files;
    totalFolders += it.stats.folders;
    totalBytes += it.stats.bytes;
  }
}
out.totals = { files: totalFiles, folders: totalFolders, bytes: totalBytes };

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/resources.json", import.meta.url), JSON.stringify(out, null, 2));

console.log("Wrote src/data/resources.json");
console.log(
  `Top-level resources: ${Object.values(out.groups).reduce((a, g) => a + g.length, 0)}`
);
console.log(
  `Nested folders: ${totalFolders}  Files: ${totalFiles}  Size: ${(totalBytes / 1073741824).toFixed(2)} GB`
);
