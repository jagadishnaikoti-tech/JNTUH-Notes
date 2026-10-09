# LECTURE NOTES — React Rebuild

A complete React + Vite rebuild of the **LECTURE NOTES** website
(<https://cselnr223.ccbp.tech/>), a free study-material hub for
**B.Tech — CSE & AIML (R22, JNTUH)** students.

The original site is a single HTML page that toggles between sections with
`display()` calls. This rebuild preserves **all** of its content, links and
documents, restructures the sections into real routes (so refresh / back /
forward / deep links all work), and applies a full, professional UI/UX redesign
built with the **UI/UX Pro Max** design-intelligence skill — without changing any
original label, link or document destination.

---

## Tech stack

- **React 18** (function components + hooks)
- **Vite 5** (dev server & production build)
- **JavaScript (ES6+)**
- **React Router 6** (multi-page navigation)
- **Lucide React** (SVG icon set)
- Plain **CSS3** with a token-based design system:
  `src/styles/tokens.css` (design tokens) + `src/styles/global.css` (components).
- **Google Fonts**: Cormorant Garamond (headings), Crimson Pro (body),
  Cinzel (brand wordmark), Atkinson Hyperlegible (UI chrome).

No backend is required. All documents live on public Google Drive folders and
are linked with their original URLs.

---

## Getting started

```bash
npm install
npm run dev      # start the dev server (Vite prints the local URL)
```

Production build & preview:

```bash
npm run build    # outputs to ./dist
npm run preview  # serve the production build locally
```

> **Deployment note:** the app uses `BrowserRouter`. When hosting `dist/` on a
> static server, configure an SPA fallback so unknown paths serve `index.html`
> (Vite's `preview` already does this). Without it, deep links such as
> `/year/2` would 404 on refresh.

---

## Design system (UI/UX Pro Max)

The redesign was produced with the **UI/UX Pro Max**
skill. It was installed locally with:

```bash
npx ui-ux-pro-max-cli init --ai opencode    # -> .opencode/skills/ui-ux-pro-max
```

The skill's searchable catalog was queried for an academic document library and
its `--design-system` output was persisted to
`design-system/lecture-notes/MASTER.md`. The recommendations it produced were
applied directly:

| Decision | Value (from the skill) |
| --- | --- |
| **UI style** | *Swiss Modernism 2.0* — grid system, modular, rational, mathematical spacing |
| **Palette** | *"Book brown + page amber"* — primary `#78716C`, secondary `#92400E`, accent `#D97706`, background `#FFFBEB`, foreground `#0F172A` |
| **Typography** | Cormorant Garamond (headings) + Crimson Pro (body); Cinzel wordmark; Atkinson Hyperlegible for UI labels (the skill's accessibility pairing) |
| **Spacing** | 4 / 8 / 16 / 24 / 32 / 48 / 64 px scale |
| **Radii** | 6 / 8 / 12 / 16 px + pill |
| **Shadows** | 4-step depth scale (`sm` → `xl`) |
| **Motion** | 150–300 ms transitions, `prefers-reduced-motion` honoured |
| **Icons** | Lucide (one consistent set — the skill forbids emoji-as-icons) |

Supporting `--domain ux` searches (active state, deep linking, empty/loading
states, sticky-nav padding) and `--stack react` guidance informed the navigation
and list rendering. Extended tokens (sidebar surface, warning/error states) are
derived from the primary palette and documented in `tokens.css`.

Every token lives in `:root`, so the whole visual language can be retuned from
one place. All text/background pairs were measured and exceed **WCAG AA**
(4.5:1) contrast.

---

## Project structure

```
src/
  components/
    Sidebar.jsx          # fixed left sidebar (branding, nav, attribution)
    SidebarItem.jsx      # one nav row (icon + label + tooltip)
    SidebarContext.jsx   # collapse / drawer state + useMediaQuery hook
    Header.jsx           # sticky top bar: mobile menu, breadcrumbs, search
    Breadcrumbs.jsx      # route-aware breadcrumb trail
    SearchBar.jsx        # reusable search control -> /search?q=
    SubjectCard.jsx      # subject tile on a year page
    DocumentCard.jsx     # a single document (Preview / Open / Download)
    PdfViewer.jsx        # in-app Google Drive preview overlay
    FileTree.jsx         # recursive folder -> files renderer
    Footer.jsx           # "Developed by Jagadish" + credits + feedback
    CopyrightModal.jsx   # "COPYRIGHTS ©" modal (original credits, verbatim)
    ModalContext.jsx     # modal provider/hook
    ScrollToTop.jsx      # scroll-to-top on route change
  data/
    site.js              # verbatim labels + all original links (source of truth)
    resources.json       # generated inventory of every folder/file (821 files)
    searchIndex.js       # flat searchable index (subjects + documents)
  pages/
    Home.jsx             # "/"            LECTURE NOTES landing
    YearSelect.jsx       # "/years"       Select Year
    YearSubjects.jsx     # "/year/:id"    subject list (1st–4th year)
    LearnCode.jsx        # "/code"        Explore the Tech World
    SubjectPage.jsx      # "/subject/:group/:folderId"  folder + file listing
    SearchPage.jsx       # "/search?q="   search across subjects & documents
    NotFound.jsx         # "*"            404
  styles/
    tokens.css           # design tokens
    global.css           # reset, layout, components, responsive rules
  App.jsx                # shell (sidebar + header + routed content)
  main.jsx
tools/                   # data pipeline (crawl, reports, verification)
design-system/           # UI/UX Pro Max generated MASTER.md
public/                  # static assets (no local document mirror by design)
```

---

## Navigation

The original horizontal navbar is replaced by a **left sidebar**:

- Branding at the top, "Home" and "Select Year" entries.
- **Expandable year groups** containing every subject, plus each year's
  *Important Questions* / *R22 Previous Question Papers* folders.
- *Learn Code* and *Search* entries, plus the original coding-resource links.
- **Active-page highlighting**, a **collapse/expand** control (icon-only mode),
  **tooltips when collapsed**, independent scrolling, and a **"Developed by
  Jagadish"** attribution pinned at the bottom.
- On mobile the sidebar becomes a **slide-out drawer** with a dimmed overlay; it
  closes after a destination is selected, and the body scroll is locked while
  open.

The sidebar is driven by structured data (`YEARS` + `CODE_LINKS` in
`src/data/site.js`); no navigation content is hard-coded inside the component.

---

## Content & document handling

The reference site links to **public Google Drive folders**, never to individual
files. To guarantee no content is lost, `tools/crawl-drive.mjs` enumerated every
folder and every file inside it (see `RESOURCE_INVENTORY.md` / `.csv`).

- **Top-level resources:** 59 subject / category folders (identical URLs).
- **Nested sub-folders:** 121.
- **Individual documents:** 821 (621 PDFs + docx/pptx/txt/images/videos), ~5.59 GB.

Each document is exposed in the app with its own **original Drive URL**:

- `Open` → `https://drive.google.com/file/d/<id>/view`
- `Download` → `https://drive.google.com/uc?export=download&id=<id>`
- `Preview` → in-app iframe using Drive's `…/file/d/<id>/preview` endpoint.

Per the chosen strategy (**“Link to Drive originals”**), files are **not**
mirrored locally — the original URLs *are* the preserved resources, so the app
stays lightweight and every document remains accessible exactly as published.

---

## Routes

| Route | Page |
| --- | --- |
| `/` | LECTURE NOTES home |
| `/years` | Select Year (1st–4th) + Learn Code + extra links |
| `/year/1` … `/year/4` | Subjects for that year |
| `/code` | Explore the Tech World (CODING) |
| `/subject/:group/:folderId` | Folder contents with per-file links |
| `/search?q=` | Search across all subjects & documents |
| `*` | Not found |

---

## Data pipeline (`tools/`)

| Script | Purpose |
| --- | --- |
| `crawl-drive.mjs` | Crawls every public Drive folder → `drive-inventory.json` |
| `measure-sizes.mjs` | Records each file's size → `file-sizes.json` |
| `gen-data.mjs` | Builds `src/data/resources.json` used by the app |
| `gen-report.mjs` | Writes `RESOURCE_INVENTORY.md` + `RESOURCE_INVENTORY.csv` |
| `verify.mjs` | Cross-checks app data vs. the live reference site |

Run `node tools/verify.mjs` to re-confirm that every folder link, external link,
subject label and year name from the reference site is present.

---

## Accessibility & quality

- Semantic landmarks (`aside`, `header`, `nav`, `main`, `footer`) and labelled
  interactive controls; `aria-current`, `aria-expanded`, `aria-controls`.
- Keyboard support: visible focus rings, `Esc` closes the modal and the viewer,
  the collapse/drawer controls are real `<button>`s.
- `prefers-reduced-motion` disables transitions.
- Empty, error and “not found” states for missing documents/routes; the search
  page has idle, results, truncated and no-match states.
- Responsive layout (mobile / tablet / desktop); the main column reflows to the
  sidebar width and never scrolls horizontally.
- No fabricated statistics — all counts shown (files, folders, sizes, subject
  counts) come from the crawled inventory.

---

## Developer attribution

The visible attribution reads **“Developed by Jagadish”** in the sidebar and the
footer. The original copyright-credits dialog content (including the historical
names it lists) is preserved verbatim in the `COPYRIGHTS ©` modal.

See **MIGRATION_REPORT.md** for the full discovered/retrieved/verified breakdown,
the redesign summary and the list of known limitations.
