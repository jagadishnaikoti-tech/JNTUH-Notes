// Crawls public Google Drive folders referenced by the reference site
// and writes a full inventory of folders/files to tools/drive-inventory.json
import { writeFile } from "node:fs/promises";

const GROUPS = {
  home: [],
  syllabus: [
    ["R18 pdf's", "14BR8ItAGLYSSvvVkDiDMQH9HdM_M91od"],
    ["R22 Syllabus Copy CSE & AIML", "1kl723nNIZpQqBS5PkMpyARN-Nex1spwT"],
  ],
  learncode: [
    ["NOTES", "1iRu-rmlZXdMYuPjlustJ-WuZ8diGOMLx"],
    ["INTERVIEW QN's", "1hfjcoHPZkwjHuXB08mlyDvzDeOClxKiA"],
    ["PROJECTS", "1iC3GyREkftJT-3l37Uz1cWDXFxW8y72l"],
    ["PLACEMENT", "1SkCOcAS0Kqvuz-MJkkjbFr1GSue6Ms6m"],
  ],
  year1: [
    ["M1 M2", "1LHPX3Zo-lAi-YL5wf2IA4KSMGIQe8AJq"],
    ["PPS", "1MSTFxfF1nUJ3V38BEma61qkuWqEulPaY"],
    ["AP", "1MMb2UQI0jHKbUzih_1OX5HQ226RBXVn2"],
    ["ENG", "1MK5DdUXW5ME-DnMW8_MYVZOKpsD2RB4u"],
    ["BEE", "1glYohtTM6ptEudoYwCNKynlAigwInTjV"],
    ["EDC", "1MMD0rjnv2SKQVp6b5B6AfdMpT56H2DSN"],
    ["CAEG", "1dlu9hJ44vAbprx3_dxKuuU0_TlZR1prM"],
    ["CHEM", "1hY5rckMoFJ5LXwyLK2gng0028fIi2n2d"],
    ["Important Questions", "1KzasgqcGh6_MCwjWqSAnB8wG8p_7TK8N"],
    ["R22 Previous Question Papers", "1KVB3WUBf_3UPhNfTdREIuJIutbDBoKcU"],
  ],
  year2: [
    ["COSM", "1qovgGl6Bja24HNj4oU5-UbgX8ZTkCYBT"],
    ["MSF", "1-gRtgAuWPug55MP_AXDjtsF26isQXgcr"],
    ["DM", "1eea3CbX7MzOdPWLyOscOLzzsGw2vaOjO"],
    ["COA", "1l6U_FcgXlFrZZMnY-Gr6RlqsMZoJCQnU"],
    ["JAVA", "1r88phLO0j5IGMeVVd2FBgisCV4iXPLQ6"],
    ["DBMS", "1eWfZteUvaRuD89F8BWibCIlzXAhdjqBv"],
    ["BEFA", "1e_q_ht8AoMKyDueW9Usx0mncNkYuxVpB"],
    ["LABS", "1q7HdV5CLtxLxa345e8I99fgvlDWp8VK1"],
    ["OS", "1bUhmQUZdgItKXcLjldk2IUcdBxzVjC9v"],
    ["DS", "1r-u9MooJE4rhU3zVG-cxVdlg6IlIe1bo"],
    ["DE", "1jZ6H30aoBW8ahs_3T31FNI6_Q42qi6zL"],
    ["SE", "1edJbs_nkbRazcOMq40SalMPsoeOBrlLr"],
    ["Important Questions", "1LiHRY7B1Z0cHOzcdEhNqs-VPSCZ3m5eE"],
    ["R22 Previous Question Papers", "1Z7v6X66tgtpXGdsBiCWH1JyYcVjPbS-W"],
  ],
  year3: [
    ["DevOps", "1lhYUvMBiY3KXrfFo5HjiT-PjsejmbhF1"],
    ["DAA", "1ljY1MgcWGVLCZ9hRHNaPffYa0JAuCD8y"],
    ["IRS", "1lqKeHxfc0AR3Nn0q-O1SzQkm3AD1PIh0"],
    ["IDS", "12Rr0_pvh3pJWvg1UWjQb2NX7e2jXdrIQ"],
    ["PPL", "12e1jTNZFWOxHlfAaX_g0FHN3Yiz_sU6a"],
    ["BEFA", "1e_q_ht8AoMKyDueW9Usx0mncNkYuxVpB"],
    ["NLP", "1lsJyrJhGlcIfXUe5Sn-iE3Eb8sVAI8DJ"],
    ["CN", "1YP1SAL7zZjcdeC0JxTkmJUptgyAQ2ZGT"],
    ["DA", "1mDkgkoRPkZD5ytOTBW0p53OzqzblqXEs"],
    ["LABS", "1-tBXNf1a4ISX9AkMwWRj7xuG10_352iu"],
    ["FLAT", "1-q9IOoAkQR2V70BVG2aUa-iKQGDlIBN_"],
    ["FIoT", "1TfETCJGWxza9kjmWX4fFNO__-CPYWE_-"],
    ["STM", "1aBzCZfpY_F581eAykLENupZJw2pm52HH"],
    ["AI", "1UILdNkRttSnuF2hm4PBSx8pxr98yBrlm"],
    ["ML", "1alQr3MBfFrvDiWlazlZG3OK6SxVDVO_o"],
  ],
  year4: [
    ["CC", "1j8u9QNyJW8zaxvAELcF3XYzlwDWaYd-F"],
    ["CD", "1Mlbzz1UNUO5FS8bfL55OxpxykXB6RfHx"],
    ["CNS", "1yGGOR788SIzVHM8atbVnobpUxNhZqmBA"],
    ["SMS", "1yiRAlVSzGM_TiJSsDcWvDyGTeLyKhL1H"],
    ["NIC", "1XUvv8sY_y2WIB1RsO-jWL-mI24eOCa1A"],
    ["SPPM", "15IaErt4Pi1vtVAHtnd6r4vbdCYwbAaOA"],
    ["IEM", "1rqbVb9wSJoT30ZGlJV2I2owMHg9ihosC"],
    ["MC", "1anmRW-42q2pKq5aTRevQn3ByCdPSxfkq"],
    ["LABS", "1D-aRww0SoLhHEXSQdxsCznVzkIMZKuP8"],
    ["OB", "1OfFe53uahO3EeQCjuCWHiXZYyUoRpd0r"],
    ["ED", "1XQlOln8RYt46xYq5S5IP0JMvZDopFW_7"],
    ["DS", "1sMLTYGHHBRkf8dXGrC0YE7QwDqEg-hiR"],
    ["WS", "1YBiikSiTlHxgi2dLQ7vXR7EwdEWcllCJ"],
    ["HCI", "1rpT0yWjOxLk24HFqyUfHU5ZryZcfOa-O"],
    ["Important Questions", "1INd-6RhfWOEPRgpwdxDkDXUjLbwCZlh6"],
  ],
};

const unescapeHtml = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");

function parseEntries(html) {
  const out = [];
  const blocks = html.split('class="flip-entry"').slice(1);
  for (const b of blocks) {
    const idM = b.match(/id="entry-([^"]+)"/);
    const hrefM = b.match(/<a href="([^"]+)"/);
    const labelM = b.match(/aria-label="([^"]+)"/);
    const titleM = b.match(/flip-entry-title">([^<]*)</);
    const dateM = b.match(/flip-entry-last-modified"><div>([^<]*)</);
    if (!idM) continue;
    const href = hrefM ? unescapeHtml(hrefM[1]) : "";
    const isFolder = /\/drive\/folders\//.test(href);
    out.push({
      id: idM[1],
      title: titleM ? unescapeHtml(titleM[1]) : "",
      isFolder,
      kind: labelM ? unescapeHtml(labelM[1]) : "",
      href,
      modified: dateM ? dateM[1] : "",
    });
  }
  return out;
}

async function listFolder(folderId) {
  const url = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return parseEntries(await r.text());
    } catch (e) {
      if (attempt === 3) return { error: String(e) };
      await new Promise((res) => setTimeout(res, 400 * attempt));
    }
  }
}

async function crawl(folderId, depth, seen) {
  if (seen.has(folderId)) return { id: folderId, cached: true, children: [] };
  seen.add(folderId);
  const entries = await listFolder(folderId);
  if (entries.error) return { id: folderId, error: entries.error, children: [] };
  const children = [];
  for (const e of entries) {
    if (e.isFolder && depth < 4) {
      const sub = await crawl(e.id, depth + 1, seen);
      children.push({ ...e, children: sub.children, error: sub.error });
    } else {
      children.push({ ...e, children: [] });
    }
  }
  return { id: folderId, children };
}

const result = { generatedAt: new Date().toISOString(), groups: {} };
for (const [group, items] of Object.entries(GROUPS)) {
  result.groups[group] = [];
  for (const [label, id] of items) {
    const tree = await crawl(id, 0, new Set());
    result.groups[group].push({ label, id, tree });
    process.stdout.write(`. ${group}/${label}\n`);
  }
}

function countFiles(nodes) {
  let folders = 0,
    files = 0;
  for (const n of nodes) {
    if (n.isFolder) {
      folders++;
      const s = countFiles(n.children || []);
      folders += s.folders;
      files += s.files;
    } else files++;
  }
  return { folders, files };
}

const summary = {};
for (const [group, items] of Object.entries(result.groups)) {
  summary[group] = { topFolders: items.length, ...countFiles(items.flatMap((i) => i.tree.children)) };
}
result.summary = summary;

await writeFile(new URL("./drive-inventory.json", import.meta.url), JSON.stringify(result, null, 2));
console.log("\nSUMMARY");
console.log(JSON.stringify(summary, null, 2));
