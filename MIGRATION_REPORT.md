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
| Top-level resource folders | **59** |
| Nested sub-folders | **121** |
| Individual documents | **821** |
| — of which PDFs | **621** |
| Total reported size | **~5.59 GB** |
| External links | 11 |

Every subject folder on the site was enumerated by crawling Google Drive's
public `embeddedfolderview` endpoint (no API key required). The complete,
machine-readable mapping is in **`RESOURCE_INVENTORY.csv`** (942 rows: 821 files
+ 121 folders) and **`src/data/resources.json`**.

---

## 2. What was preserved

- **All subject names & categories** — 50 subject tiles across the four years
  plus "Important Questions" / "R22 Previous Question Papers" text links and the
  "Learn Code" links, in the original order.
- **All original links & destinations** — the 11 external links (WhatsApp share,
  feedback, update pdfs, results, GUARNTEE QNS, CSE Pdfs bot, R18, R22 syllabus,
  roadmap.sh, CodSoft, CodeChef) are byte-for-byte the original URLs.
- **All documents** — every one of the 821 files inside the 59 Drive folders is
  reachable in the app via its own original Drive `view`/`download` URL, and the
  original folder URL is shown on each subject page.
- **All visible text** — headings, taglines, the "Note: For More pdf's…" line,
  course meta (B.Tech / CSE & AIML / R22 / JNTUH), button labels, the copyright
  modal body, and the footer.
- **All interactive features** — the copyright modal, the "Get Started" flow, the
  year/subject drill-down, and the Learn Code hub.
- **Original visual identity** — background gradient, radially-lit panel,
  Times New Roman headings (red/dark-green/dark-blue), brown pill buttons,
  `#171765` outlined buttons, button hover scale/glow.

### Intentional, additive improvements (no content changed)

- Sections became **real routes** so refresh / back / forward / deep-linking work.
- The navbar **search box is now functional** (it searched nothing on the
  original) and searches all 59 subjects + 821 documents.
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

## 6. Frontend redesign (UI/UX Pro Max)

The entire frontend was upgraded into a premium academic platform using the
**UI/UX Pro Max** skill.

- **Installed** via `npx ui-ux-pro-max-cli init --ai opencode` →
  `.opencode/skills/ui-ux-pro-max` (OpenCode exposes it as the
  `ui-ux-pro-max` skill). Python 3.14 was already available for its search script.
- **Consulted** its `--design-system` engine for an education / document library
  and persisted the result to `design-system/lecture-notes/MASTER.md`, then ran
  supporting `--domain ux`, `--domain icons`, `--domain typography` and
  `--stack react` searches.

Applied recommendations:

| Area | Applied |
| --- | --- |
| Style | **Swiss Modernism 2.0** — rational grid, mathematical spacing, clear hierarchy |
| Palette | *"Book brown + page amber"*: `#78716C` / `#92400E` / `#D97706` on `#FFFBEB` |
| Type | Cormorant Garamond + Crimson Pro (+ Cinzel wordmark, Atkinson Hyperlegible UI) |
| Spacing / radii / shadows / motion | Token scales in `src/styles/tokens.css` |
| Icons | **Lucide** SVG set (skill anti-pattern: no emoji-as-icons) |
| A11y | Contrast ≥ 4.5:1 verified, visible focus, `prefers-reduced-motion`, ARIA |

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

Validation performed in a real browser (DOM/computed-style checks — no visible
desktop for screenshots in this environment):

- Desktop (≥1024 px): sidebar fixed at 272 px, content offset 272 px, mobile
  chrome hidden; icon-only collapse → 76 px with working tooltips.
- Mobile (<1024 px): hamburger opens the drawer; selecting a subject navigates
  and auto-closes the drawer.
- All routes render; **0 console errors** (only React Router v7 informational
  flags); **0 horizontal overflow** at every breakpoint tested.
- Credits modal opens, focuses its close button, and closes on `Esc`; document
  preview loads the correct `drive.google.com/file/d/<id>/preview` iframe.
- All key text/background contrast pairs measured between **5.49:1 and 17.2:1**.

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
