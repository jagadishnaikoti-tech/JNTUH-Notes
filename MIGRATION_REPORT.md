# Migration Report

**Reference (source of truth):** <https://cselnr223.ccbp.tech/>
**Rebuild:** React 18 + Vite 5 + React Router 6
**Status:** Complete — builds successfully, all routes verified, all content preserved.

---

## 1. Audit of the reference website

The reference site is a **single HTML page** (`index.html`) that shows one of
seven sections at a time via a `display(id)` JavaScript toggle. There is **no
login gate** (verified in a real browser: no auth screen, empty `localStorage`),
**no images/logos** (the only "assets" are emoji and Font Awesome icons), and no
external CSS/JS beyond Bootstrap and one small login-styling block that is not
rendered.

### Sections (states) discovered

| Section id | Visible title |
| --- | --- |
| `sectionHome` | **LECTURE NOTES** — "Free Learning Platform for Better Result" |
| `sectionyr` | **Select Year** |
| `sectionsub` | **1st Year** — SUBJECTS |
| `sectionsub2` | **2nd Year** — SUBJECTS |
| `sectionsub3` | **3rd Year** — SUBJECTS |
| `sectionsub4` | **4th Year** — SUBJECTS |
| `sectioncode` | **Explore the Tech World** — CODING |

The navbar, the "COPYRIGHTS ©" modal and the "Developed by JASHVA" footer are
shared across sections.

### Content inventory

| Item | Count |
| --- | ---: |
| Unique top-level Drive folders | **59** |
| Top-level catalog entries | **60** |
| Nested sub-folders | **121** |
| Indexed document entries | **821** |
| Unique Drive file IDs | **803** |
| — of which PDFs | **621** |
| Total reported size | **~5.59 GB** |
| External links | 11 |

Every subject folder on the site was enumerated by crawling Google Drive's
public `embeddedfolderview` endpoint (no API key required). The complete,
machine-readable mapping is in **`RESOURCE_INVENTORY.csv`** (942 rows: 821 files
+ 121 folders) and **`src/data/resources.json`**.

The generated app catalog has 60 top-level entries but 59 unique Drive folder
IDs because the same BEFA folder is listed under two year groups. The 821
indexed document entries include 18 cross-folder reuses, so they represent 803
unique file IDs. The CSV's 942 data rows count the indexed file and nested-folder
entries, not the top-level catalog entries.

---

## 2. What was preserved

- **All subject names & categories** — 50 subject tiles across the four years
  plus "Important Questions" / "R22 Previous Question Papers" text links and the
  "Learn Code" links, in the original order.
- **All original links & destinations** — the 11 external links (WhatsApp share,
  feedback, update pdfs, results, GUARNTEE QNS, CSE Pdfs bot, R18, R22 syllabus,
  roadmap.sh, CodSoft, CodeChef) are byte-for-byte the original URLs.
- **All documents** — all 821 indexed file entries across the 60 catalog entries
  (59 unique Drive folders) are reachable via their original Drive
  `view`/`download` URLs, and the original folder URL is shown on each subject
  page.
- **All visible text** — headings, taglines, the "Note: For More pdf's…" line,
  course meta (B.Tech / CSE & AIML / R22 / JNTUH), button labels, the copyright
  modal body, and the footer.
- **All interactive features** — the copyright modal, the "Get Started" flow, the
  year/subject drill-down, and the Learn Code hub.
- **Original wording and branding** — the source text and labels were retained;
  the original visual treatment was redesigned rather than reproduced. The
  current Claymorphism styling is documented in section 6.

### Intentional, additive improvements (no content changed)

- Sections became **real routes** so refresh / back / forward / deep-linking work.
- The navbar **search box is now functional** (it searched nothing on the
  original) and searches all 60 top-level catalog entries + 821 indexed document
  entries.
- **Per-file listings + in-app preview** on subject pages (the original only gave
  a folder link). The original folder link is still shown and clickable.
- Responsive behaviour, keyboard access, `Esc`-to-close, empty/error/404 states.

---

## 3. Retrieval status

| Status | Count | Notes |
| --- | ---: | --- |
| Folders discovered & linked | 59 | All original URLs preserved. |
| Folders enumerated (files listed) | 56 | Contents publicly listable and indexed. |
| Files indexed & linked | 821 | Each has an original `view` + `download` URL. |
| Files mirrored locally | 0 | By design — see below. |
| Folders not enumerable | 3 | See limitations. |

**Why nothing was mirrored locally:** the user selected the *"Link to Drive
originals"* strategy. Mirroring would mean downloading **5.59 GB** into the
project; because the reference site itself only links to Drive folders, the
faithful migration is to preserve those exact URLs. Every individual file is
additionally exposed with its own Drive URL, so accessibility is *expanded*, not
reduced. (If a local mirror is ever wanted, `tools/` contains the full file-id →
name → size mapping needed to script it.)

---

## 4. Verification (automated)

`tools/verify.mjs` re-fetches the live reference HTML and compares it to the
shipped data. Latest result:

```
referenceFoldersOnSite : 59
appTopLevelFolders     : 59
missingFolderIds       : []
missingExternalLinks   : []
missingSubjectLabels   : []
missingYearNames       : []
totalFilesIndexed      : 821
sharedFilesAcrossFolders: 18   (same file legitimately in several folders)
withinSubjectDuplicateFileIds: []
duplicateFolderRefs    : false
VERIFICATION PASSED
```

Manual / browser checks (dev server, no console errors on any route):

- `/`, `/years`, `/year/1` … `/year/4`, `/code`, a representative
  `/subject/year1/…`, `/search?q=dbms`, and an unknown path all rendered
  correctly with the expected text and links.
- Subject page shows real file names, sizes and working Preview/Open/Download
  actions (e.g. `M1 M2` → 29 files, 5 sub-folders, 284 MB).
- `npm run build` completes with no errors.

---

## 5. Known limitations (honest, not fabricated)

| Resource | Original URL | Limitation |
| --- | --- | --- |
| Learn Code → **PLACEMENT** | `https://drive.google.com/drive/u/0/mobile/folders/1SkCOcAS0Kqvuz-MJkkjbFr1GSue6Ms6m` | **Broken on the original site** — Drive returns HTTP 404. The link is preserved exactly as-is (destination not altered). |
| 4th Year → **SMS** | `…/folders/1yiRAlVSzGM_TiJSsDcWvDyGTeLyKhL1H` | Folder is reachable but has **no publicly listed contents** (shows "empty" state). |
| 4th Year → **Important Questions** | `…/folders/1INd-6RhfWOEPRgpwdxDkDXUjLbwCZlh6` | Folder is reachable but has **no publicly listed contents**. |
| 4th Year → **SVP** | (empty `href=""` on the reference site) | The original link is empty. Preserved as a clearly-disabled tile; no destination was invented. |
| Google-Docs-type entries | e.g. “FORMULAS”, “DATA BASE”, “1 Mark Answers r22” | Stored in Drive without a file extension; shown with a generic **FILE** badge. Open/Download still resolve via their Drive ids. |
| Cross-site preview | — | Google Drive's embed page is used for in-app preview; if a browser/extension blocks third-party iframes, users fall back to **Open in Drive** / **Download**. |

None of the above are caused by the migration — all are pre-existing properties
of the source links, documented rather than hidden.

---

## 6. Frontend design (current implementation)

The shipped interface uses the Claymorphism design tokens in
`src/styles/tokens.css`. Earlier migration notes describing Swiss Modernism,
book-brown colors and serif fonts are historical and do not describe the
current styling.

| Area | Applied |
| --- | --- |
| Style | **Claymorphism** — ink borders, raised cards, offset shadows and press feedback |
| Palette | Coral `#FDBCB4`, sky `#ADD8E6`, green CTA `#22C55E`, ink `#2D3748`, white canvas and warm surfaces; dark-theme overrides are tokenized |
| Type | Fredoka headings + DM Sans body and interface |
| Sidebar widths | 276 px expanded / 78 px collapsed |
| Spacing / radii / shadows / motion | Shared token scales in `src/styles/tokens.css` |
| Icons | Lucide SVG icons |
| Accessibility | Visible focus, reduced-motion support, semantic controls and ARIA labels |

Structural changes:

- **Horizontal navbar → left sidebar** (`Sidebar.jsx` + `SidebarItem.jsx` +
  `SidebarContext.jsx`): branding, Home, Select Year, expandable per-year subject
  groups (incl. each year's extra folders), Learn Code, Search and the coding
  links; active highlighting, collapse-to-icons, tooltips, independent scroll,
  and a developer attribution at the bottom.
- **Mobile drawer**: the sidebar slides in over a dimmed overlay, locks body
  scroll, and closes on navigation.
- **Sticky header** (`Header.jsx`) with the mobile menu button, breadcrumbs
  (`Breadcrumbs.jsx`) and a working search (`SearchBar.jsx`).
- Every page redesigned against the same system (`Home`, `YearSelect`,
  `YearSubjects`, `SubjectPage`, `LearnCode`, `SearchPage`, `NotFound`), plus
  shared `SubjectCard`, `DocumentCard`, `PdfViewer`, `FileTree`, `Footer`,
  `CopyrightModal`.
- **Attribution** changed to **“Developed by Jagadish”** (sidebar + footer). The
  original `COPYRIGHTS ©` dialog (VARUN & HARISH / Nagaraju & Abhilash / college)
  is preserved verbatim.

The following browser checks were recorded during the migration; pixel
measurements from that pass are historical, not current style specifications:

- Desktop (≥1024 px): sidebar fixed at 272 px, content offset 272 px, mobile
  chrome hidden; icon-only collapse → 76 px with working tooltips.
- Mobile (<1024 px): hamburger opens the drawer; selecting a subject navigates
  and auto-closes the drawer.
- All routes render; **0 console errors** (only React Router v7 informational
  flags); **0 horizontal overflow** at every breakpoint tested.
- Credits modal opens, focuses its close button, and closes on `Esc`; document
  preview loads the correct `drive.google.com/file/d/<id>/preview` iframe.
- Contrast and responsive checks were performed against the design in use at
  that time; these figures are not a current re-certification.

`npm run build` succeeds; the bundle is split into `index` / `vendor` /
`resources` chunks (each < 500 kB) for caching.

---

## 7. How to run

```bash
npm install
npm run dev      # development
npm run build    # production build -> dist/
npm run preview  # serve the production build
node tools/verify.mjs   # re-run the reference-vs-app verification
```
