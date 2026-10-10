# JNTUH Notes

A free study-material hub for **B.Tech — CSE & AIML (R22, JNTUH)** students.
React + Vite front end that organises every subject, document and exam resource
into real, deep-linkable routes.

The project began as a rebuild of the original **LECTURE NOTES** single-page site
(<https://cselnr223.ccbp.tech/>). All of its content, links and documents are
preserved with their original destinations, restructured into routes (so refresh,
back, forward and deep links all work), and presented with a restrained,
academic visual system. No original label, link or document was changed or
invented.

---

## Tech stack

- **React 18** (function components + hooks)
- **Vite 5** (dev server & production build)
- **JavaScript (ES6+)**
- **React Router 6** (multi-page navigation)
- **Lucide React** (single SVG icon set)
- Plain **CSS3** with a token-based design system:
  `src/styles/tokens.css` (tokens) + `src/styles/global.css` (components)
- **Google Fonts**: Cormorant Garamond (headings), Crimson Pro (body),
  Cinzel (brand wordmark), Atkinson Hyperlegible (UI chrome)

No backend is required. All documents live on public Google Drive folders and are
linked with their original URLs.

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
> (Vite's `preview` already does this). `vercel.json` in this repo provides the
> rewrite for Vercel, so deep links such as `/year/2` work on refresh.

---

## Routes

| Route | Page |
| --- | --- |
| `/` | Home |
| `/years` | Select Year (1st–4th) + extra sections |
| `/year/1` … `/year/4` | Subjects for that year |
| `/code` | Explore the Tech World (coding resources) |
| `/subject/:group/:folderId` | Folder contents with per-file links |
| `/search?q=` | Search across subjects, folders and documents |
| `/questions/guaranteed` | Guaranteed Questions index |
| `/questions/short` | Short Questions index |
| `/privacy-policy` | Privacy Policy |
| `/terms-and-conditions` | Terms & Conditions |
| `*` | Not found (404) |

---

## Features

### Navigation

A left **sidebar** replaces the original horizontal navbar:

- Branding, **Home** and **Select Year** entries.
- Expandable year groups containing every subject, plus each year's *Important
  Questions* / *R22 Previous Question Papers* folders.
- **Learn Code** and **Search**, plus the coding-resource links from the original
  site (NOTES, ROAD-MAP, INTERVIEW QN's, INTERNSHIP, PROJECTS, PLACEMENT,
  PRACTICE), each with its own icon.
- Active-page highlighting, collapse/expand (icon-only mode), tooltips when
  collapsed, independent scrolling, and a **"Developed by Jagadish"**
  attribution.
- On mobile the sidebar becomes a slide-out drawer with a dimmed overlay; it
  closes after a destination is selected and locks body scroll while open.

Navigation is driven by structured data (`YEARS` + `CODE_LINKS` in
`src/data/site.js`); nothing is hard-coded in the components.

### Header

The sticky top bar holds the breadcrumb trail on the left, a **centered search
field** in the middle (full width on smaller screens), and the **light/dark
theme toggle** on the right. On mobile the toggle and menu share the top row and
the search moves to a full-width second row.

### Light and dark mode

A header toggle switches the whole palette between the warm parchment light
theme and a warm-charcoal dark theme. **Dark is the default**; once the visitor
uses the toggle the choice is stored in `localStorage` (`ln:theme`) and wins on
later visits. An inline script in `index.html` applies the saved theme before the
first paint (no flash), and the browser `theme-color` is kept in sync. Both
themes are token-driven from `src/styles/tokens.css` and independently meet WCAG
AA contrast.

### Search (`src/lib/search.js`)

A local, dependency-free index over the real inventory:

- Covers subject/folder names, file titles, file extensions/types, year names and
  full Drive paths.
- Case-insensitive, whitespace-tolerant, partial-word and multi-word (AND)
  queries, plus formatting variants such as `unit-2`, `unit 2` and `unit2`.
- Documents that are real question sets also carry category keywords derived from
  the same classifier the Q&S pages use, so `guaranteed questions`,
  `short questions`, `important` and `2 marks` surface the actual files.
- Real idle, results, truncated and no-match states; keyboard operable; every
  result links to a real route or the original document.

### Question sets (`src/data/questions.js`)

Guaranteed Questions and Short Questions are derived from `resources.json` (year
groups only) and classified purely from real file titles. Each entry maps back to
its original Drive URL, download URL and the in-app subject-folder route. Nothing
is invented and the pages do not claim any exam appearance is guaranteed. Where a
category has no material, the page says so honestly.

### Footer

Clean multi-column footer with only verified destinations (Home, Subjects, Years,
Question sets, Privacy Policy, Terms) plus the original feedback channel, a
dynamic year, and the preserved "Developed by Jagadish" attribution.

### SEO & metadata

- `src/lib/meta.js` sets a per-route `<title>` and meta description.
- Favicon set generated from an original vector mark:
  `public/favicon.svg`, `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`.
- `public/robots.txt`, theme-color and accurate descriptions in `index.html`.

---

## Design system

The visual language is a restrained academic system (warm parchment + amber/brown,
Swiss-style grid and spacing), initially produced with the **UI/UX Pro Max**
design-intelligence skill and persisted to
`design-system/lecture-notes/MASTER.md`. Key values:

| Decision | Value |
| --- | --- |
| **UI style** | Swiss Modernism — grid system, modular, rational spacing |
| **Palette** | primary `#78716C`, secondary `#92400E`, accent `#D97706`, background `#FFFBEB`, foreground `#0F172A` |
| **Typography** | Cormorant Garamond (headings) + Crimson Pro (body); Cinzel wordmark; Atkinson Hyperlegible for UI labels |
| **Spacing** | 4 / 8 / 16 / 24 / 32 / 48 / 64 px scale |
| **Radii** | 6 / 8 / 12 / 16 px (buttons and controls use moderate radii, not pills) |
| **Shadows** | 4-step depth scale |
| **Motion** | 150–300 ms transitions, `prefers-reduced-motion` honoured |
| **Icons** | Lucide (one consistent set) |

Every token lives in `:root`, so the whole visual language can be retuned from one
place. All text/background pairs exceed **WCAG AA** contrast.

---

## Project structure

```
src/
  components/
    Sidebar.jsx            # left sidebar (branding, nav, attribution)
    SidebarItem.jsx        # one nav row (icon + label + optional external link)
    SidebarContext.jsx     # collapse / drawer state + useMediaQuery
    Header.jsx             # sticky top bar: menu, breadcrumbs, search, theme
    ThemeToggle.jsx        # light/dark mode switch (top-right)
    Breadcrumbs.jsx        # route-aware breadcrumb trail
    SearchBar.jsx          # reusable search control -> /search?q=
    SubjectCard.jsx        # subject tile on a year page
    DocumentCard.jsx       # a single document (Preview / Open / Download)
    PdfViewer.jsx          # in-app Google Drive preview overlay
    FileTree.jsx           # recursive folder -> files renderer
    QuestionSetsSection.jsx# home-page summary of the question sets
    Footer.jsx             # link columns + legal + attribution
    LegalPage.jsx          # shared shell for the legal pages
    Legal*.jsx / modal infra # preserved auth/credits infrastructure
    ScrollToTop.jsx        # scroll-to-top on route change
  data/
    site.js                # labels + all original links (source of truth)
    resources.json         # generated inventory of every folder/file (821 files)
    questions.js           # derived question-set index + classifier
  lib/
    search.js              # local search engine
    meta.js                # per-route title + meta description
    theme.js               # light/dark theme read + persistence
  pages/
    Home.jsx               # "/"
    YearSelect.jsx         # "/years"
    YearSubjects.jsx       # "/year/:id"
    LearnCode.jsx          # "/code"
    SubjectPage.jsx        # "/subject/:group/:folderId"
    SearchPage.jsx         # "/search?q="
    QuestionsPage.jsx      # "/questions/:category"
    PrivacyPolicy.jsx      # "/privacy-policy"
    TermsConditions.jsx    # "/terms-and-conditions"
    NotFound.jsx           # "*"
  styles/
    tokens.css             # design tokens
    global.css             # reset, layout, components, responsive rules
  App.jsx                  # shell (sidebar + header + routed content)
  main.jsx
tools/                     # data pipeline (crawl, reports, verification, favicon)
design-system/             # UI/UX Pro Max generated MASTER.md
public/                    # favicon set + robots.txt (no local document mirror)
```

---

## Content & document handling

The reference site links to **public Google Drive folders**, never to individual
files. To guarantee no content is lost, `tools/crawl-drive.mjs` enumerated every
folder and every file inside it (see `RESOURCE_INVENTORY.md` / `.csv`).

- **Top-level resources:** 59 subject / category folders (identical URLs)
- **Nested sub-folders:** 121
- **Individual documents:** 821 (621 PDFs + docx/pptx/txt/images/videos), ~5.59 GB

Each document is exposed with its own **original Drive URL**:

- `Open` → `https://drive.google.com/file/d/<id>/view`
- `Download` → `https://drive.google.com/uc?export=download&id=<id>`
- `Preview` → in-app iframe using Drive's `…/file/d/<id>/preview` endpoint

Files are **not** mirrored locally — the original URLs *are* the preserved
resources, so the app stays lightweight and every document remains accessible
exactly as published.

---

## Data pipeline (`tools/`)

| Script | Purpose |
| --- | --- |
| `crawl-drive.mjs` | Crawls every public Drive folder → `drive-inventory.json` |
| `measure-sizes.mjs` | Records each file's size → `file-sizes.json` |
| `gen-data.mjs` | Builds `src/data/resources.json` used by the app |
| `gen-report.mjs` | Writes `RESOURCE_INVENTORY.md` + `RESOURCE_INVENTORY.csv` |
| `verify.mjs` | Cross-checks app data vs. the live reference site |
| `gen-favicon.mjs` | Generates the favicon set from an original vector mark |

Run `node tools/verify.mjs` to re-confirm that every folder link, external link,
subject label and year name from the reference site is present.

---

## Accessibility & quality

- Semantic landmarks (`aside`, `header`, `nav`, `main`, `footer`) and labelled
  controls; `aria-current`, `aria-expanded`, `aria-controls`.
- Keyboard support with a visible, high-contrast `:focus-visible` ring; `Esc`
  closes the preview overlay and modals.
- `prefers-reduced-motion` disables transitions.
- Empty, error and "not found" states for missing documents/routes; the search
  page has idle, results, truncated and no-match states.
- Responsive layout (mobile / tablet / desktop); the content column never scrolls
  horizontally.
- No fabricated statistics — every count shown comes from the crawled inventory.
- Light and dark themes both verified; the header theme toggle is a real button
  with `aria-pressed` and an accessible label, and its state persists across
  reloads.
- Lighthouse (production build): **Accessibility 100 · Best Practices 100 · SEO
  100** on the home, search and question-set pages, in **both** light and dark
  themes.

---

## Developer attribution

The visible attribution reads **"Developed by Jagadish"** in the sidebar and the
footer. See **MIGRATION_REPORT.md** for the full discovered / retrieved / verified
breakdown and known limitations.
