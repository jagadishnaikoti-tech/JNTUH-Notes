import { readFile, writeFile } from "node:fs/promises";

const inv = JSON.parse(await readFile(new URL("./drive-inventory.json", import.meta.url), "utf8"));

const files = [];
function walk(nodes, path) {
  for (const n of nodes || []) {
    const p = [...path, n.title];
    if (n.isFolder) walk(n.children, p);
    else files.push({ ...n, path: p });
  }
}
for (const [group, items] of Object.entries(inv.groups)) {
  for (const it of items) walk(it.tree ? it.tree.children : [], [group, it.label]);
}

const targets = files.filter((f) => /\.(pdf|docx|pptx|ppt|zip|txt|rtf|png|jpg|jpeg)$/i.test(f.title));

async function sizeOf(f) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch("https://drive.google.com/uc?export=download&id=" + f.id, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
      });
      const cr = r.headers.get("content-range");
      if (cr) return parseInt(cr.split("/")[1], 10);
      const cl = r.headers.get("content-length");
      if (cl) return parseInt(cl, 10);
      return 0;
    } catch (e) {
      if (a === 3) return -1;
      await new Promise((r) => setTimeout(r, 300 * a));
    }
  }
}

let total = 0;
let done = 0;
const results = [];
const pool = 8;
let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const f = targets[idx++];
    const s = await sizeOf(f);
    f.bytes = s;
    total += Math.max(0, s);
    results.push(f);
    done++;
    if (done % 25 === 0) process.stdout.write(`. ${done}/${targets.length} ${(total / 1048576).toFixed(1)}MB\n`);
  }
}
await Promise.all(Array.from({ length: pool }, worker));

console.log(`\nFiles: ${targets.length}  Total: ${(total / 1048576).toFixed(1)} MB (${(total / 1073741824).toFixed(2)} GB)`);
const big = results.filter((f) => f.bytes > 20 * 1048576).sort((a, b) => b.bytes - a.bytes);
console.log("Files >20MB:", big.length);
for (const b of big.slice(0, 20)) console.log("  ", (b.bytes / 1048576).toFixed(1) + "MB", b.path.join("/"));
const zero = results.filter((f) => !f.bytes || f.bytes <= 0);
console.log("Unavailable/zero:", zero.length);

await writeFile(new URL("./file-sizes.json", import.meta.url), JSON.stringify(results, null, 2));
