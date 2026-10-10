import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  Compass,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  ListChecks,
  Search,
  SearchX,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import {
  CODE_LINKS,
  LINKS,
  YEARS,
  getResourceByFolderId,
  getYearStats,
} from "../data/site.js";
import { getQuestionSets } from "../data/questions.js";
import Footer from "../components/Footer.jsx";

// ---------------------------------------------------------------------------
// Human-readable HTML sitemap.
//
// Every entry below is derived from the real site data (src/data/site.js,
// src/data/questions.js and src/data/resources.json). Routes that do not exist
// are never listed: a section/group is only rendered when it owns at least one
// real destination. There is no separate copy of the inventory to drift out of
// sync - the same helpers the rest of the app uses build this page.
// ---------------------------------------------------------------------------

const YEAR_NAME = Object.fromEntries(YEARS.map((y) => [y.id, y.name]));

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Real subject/extra routes for a year, each backed by a crawled resource. */
function subjectItems(year) {
  const items = [];
  const push = (entry, keywords) => {
    const resource = getResourceByFolderId(entry.folderId);
    if (!resource) return; // No route/resource -> never show a dead entry.
    items.push({
      label: entry.label,
      to: `/subject/year${year.id}/${entry.folderId}`,
      meta: plural(resource.stats.files, "file"),
      keywords,
    });
  };

  for (const subject of year.subjects) {
    if (subject.disabled || !subject.folderId) continue;
    push(subject, `${year.name} subject notes`);
  }
  for (const extra of year.extras || []) {
    push(extra, `${year.name} important questions previous papers`);
  }
  return items;
}

/** Guaranteed/Short question sets, grouped by real academic year. */
function questionGroups(categoryId) {
  const sets = getQuestionSets(categoryId);
  const byYear = new Map();
  for (const set of sets) {
    if (!byYear.has(set.yearId)) byYear.set(set.yearId, []);
    byYear.get(set.yearId).push(set);
  }
  const categoryWord = categoryId === "short" ? "short 2 marks" : "important guaranteed";

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([yearId, list]) => ({
      id: `q-${categoryId}-${yearId}`,
      title: YEAR_NAME[yearId] || `Year ${yearId}`,
      meta: plural(list.length, "set"),
      items: list.map((set) => ({
        label: set.title,
        href: set.url || set.downloadUrl,
        external: true,
        meta: [set.subject, set.unit].filter(Boolean).join(" · "),
        keywords: `${YEAR_NAME[yearId] || ""} ${set.subject || ""} ${set.unit || ""} ${categoryWord}`,
      })),
    }));
}

/** Build the whole sitemap from real data. */
function buildSections() {
  const sections = [];

  sections.push({
    id: "main",
    title: "Main Pages",
    icon: Compass,
    note: "Primary entry points of JNTUH Notes.",
    items: [
      { label: "Home", to: "/", meta: "Study-material overview" },
      { label: "Select Year", to: "/years", meta: "Browse subjects by year" },
      { label: "Learn Code", to: "/code", meta: "Coding & placement resources" },
      { label: "Search", to: "/search", meta: "Search subjects, units and documents" },
      { label: "Site Map", to: "/sitemaps", meta: "This page", current: true },
    ],
  });

  sections.push({
    id: "years",
    title: "Academic Years",
    icon: GraduationCap,
    note: "Each year lists its CSE & AIML subjects and study material.",
    items: YEARS.map((year) => {
      const stats = getYearStats(year);
      return {
        label: year.name,
        to: `/year/${year.id}`,
        meta: `${plural(stats.subjects, "subject")} · ${plural(stats.files, "document")}`,
      };
    }),
  });

  sections.push({
    id: "subjects",
    title: "Semesters and Subjects",
    icon: BookOpen,
    note: "Subjects are published per academic year; each folder holds that year's notes, question sets and papers.",
    groups: YEARS.map((year) => {
      const stats = getYearStats(year);
      return {
        id: `subjects-year-${year.id}`,
        title: year.name,
        meta: `${plural(stats.subjects, "subject")} · ${plural(stats.files, "document")}`,
        items: subjectItems(year),
      };
    }),
  });

  sections.push({
    id: "guaranteed",
    title: "Guaranteed Questions",
    icon: Target,
    note: "Important question sets, grouped by year. Each links to its original document.",
    link: {
      label: "Open the Guaranteed Questions page",
      to: "/questions/guaranteed",
    },
    groups: questionGroups("guaranteed"),
  });

  sections.push({
    id: "short",
    title: "Short Questions",
    icon: ListChecks,
    note: "Short-answer and two-mark question sets, grouped by year.",
    link: { label: "Open the Short Questions page", to: "/questions/short" },
    groups: questionGroups("short"),
  });

  sections.push({
    id: "other",
    title: "Other Study Materials",
    icon: FolderOpen,
    note: "Syllabus copies and coding & placement resources.",
    groups: [
      {
        id: "other-syllabus",
        title: "Syllabus & regulation",
        meta: "2 links",
        items: [
          {
            label: "R22 Syllabus Copy CSE & AIML",
            href: LINKS.r22Syllabus,
            external: true,
            meta: "Google Drive folder",
          },
          {
            label: "R18 pdf's",
            href: LINKS.r18,
            external: true,
            meta: "Google Drive folder",
          },
        ],
      },
      {
        id: "other-code",
        title: "Coding & placement resources",
        meta: plural(CODE_LINKS.length, "link"),
        items: CODE_LINKS.map((link) => ({
          label: link.label,
          href: link.url,
          external: true,
          meta: "External resource",
        })),
      },
    ],
  });

  sections.push({
    id: "legal",
    title: "Legal and Information Pages",
    icon: ShieldCheck,
    note: "Site policies, feedback and result tools.",
    items: [
      { label: "Privacy Policy", to: "/privacy-policy", meta: "Policy" },
      { label: "Terms & Conditions", to: "/terms-and-conditions", meta: "Policy" },
      { label: "Give us Feedback", href: LINKS.feedback, external: true, meta: "WhatsApp" },
      { label: "Update Pdfs", href: LINKS.updatePdfs, external: true, meta: "Contribute material" },
      { label: "CSE Pdfs bot", href: LINKS.cseBot, external: true, meta: "Telegram bot" },
      { label: "Check Results", href: LINKS.results, external: true, meta: "JNTUH results portal" },
    ],
  });

  // Never render an empty section.
  return sections.filter(
    (s) =>
      (s.items && s.items.length > 0) ||
      (s.groups && s.groups.some((g) => g.items.length > 0)) ||
      s.link
  );
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function itemHaystack(item, sectionTitle, groupTitle) {
  return normalize(
    [item.label, item.meta, item.keywords, sectionTitle, groupTitle]
      .filter(Boolean)
      .join(" ")
  );
}

function renderItem(item) {
  const content = (
    <>
      <span className="sitemap-link-label">{item.label}</span>
      {item.meta ? <span className="sitemap-link-meta">{item.meta}</span> : null}
      {item.external ? (
        <>
          <ExternalLink className="sitemap-link-ext" size={13} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      ) : null}
    </>
  );

  if (item.current) {
    return (
      <span className="sitemap-link is-current" aria-current="page">
        {content}
      </span>
    );
  }
  if (item.href) {
    return (
      <a
        className="sitemap-link"
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </a>
    );
  }
  return (
    <Link className="sitemap-link" to={item.to}>
      {content}
    </Link>
  );
}

function renderList(items) {
  return (
    <ul className="sitemap-list">
      {items.map((item, i) => (
        <li key={`${item.id || item.to || item.href || item.label}-${i}`}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

export default function SiteMap() {
  const [query, setQuery] = useState("");
  const sections = useMemo(() => buildSections(), []);

  // Flat, searchable index of every entry on the page.
  const index = useMemo(() => {
    const entries = [];
    for (const section of sections) {
      if (section.link) {
        entries.push({
          id: `${section.id}:link`,
          label: section.link.label,
          to: section.link.to,
          meta: section.title,
          sectionId: section.id,
          haystack: normalize(`${section.link.label} ${section.title}`),
        });
      }
      (section.items || []).forEach((item, i) => {
        entries.push({
          ...item,
          id: `${section.id}:item:${i}`,
          sectionId: section.id,
          haystack: itemHaystack(item, section.title, ""),
        });
      });
      for (const group of section.groups || []) {
        group.items.forEach((item, i) => {
          entries.push({
            ...item,
            id: `${group.id}:${i}`,
            sectionId: section.id,
            haystack: itemHaystack(item, section.title, group.title),
          });
        });
      }
    }
    return entries;
  }, [sections]);

  const tokens = useMemo(
    () => normalize(query).split(" ").filter(Boolean),
    [query]
  );

  const matches = useMemo(
    () =>
      tokens.length
        ? index.filter((entry) => tokens.every((t) => entry.haystack.includes(t)))
        : null,
    [index, tokens]
  );

  const resultsBySection = useMemo(() => {
    if (!matches) return [];
    const bySection = new Map();
    for (const entry of matches) {
      if (!bySection.has(entry.sectionId)) bySection.set(entry.sectionId, []);
      bySection.get(entry.sectionId).push(entry);
    }
    return sections
      .filter((s) => bySection.has(s.id))
      .map((s) => ({ section: s, items: bySection.get(s.id) }));
  }, [matches, sections]);

  const clear = () => setQuery("");
  const hasQuery = tokens.length > 0;

  return (
    <main className="page-main">
      <div className="section-head">
        <div>
          <p className="eyebrow">JNTUH Notes</p>
          <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
            Site Map
          </h1>
          <p className="section-sub" style={{ marginTop: 4 }}>
            Browse JNTUH Notes by academic year, branch, semester, subject, and
            available study materials.
          </p>
        </div>
      </div>

      <div className="sitemap-search">
        <div className="search-input">
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="sitemap-search">
            Filter the site map
          </label>
          <input
            id="sitemap-search"
            className="search-input-field"
            type="search"
            autoComplete="off"
            value={query}
            placeholder="Filter pages by subject, year, semester or title…"
            aria-describedby="sitemap-hint"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={clear}
              aria-label="Clear filter"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {!hasQuery ? (
        <nav className="chip-row sitemap-toc" aria-label="Jump to a section">
          {sections.map((section) => (
            <a className="chip" key={section.id} href={`#sitemap-${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
      ) : null}

      <p
        className="sitemap-count"
        id="sitemap-hint"
        role="status"
        aria-live="polite"
      >
        {matches
          ? matches.length === 0
            ? `No pages match “${query.trim()}”.`
            : `${matches.length} ${matches.length === 1 ? "match" : "matches"} for “${query.trim()}”.`
          : `${plural(index.length, "link")} across ${plural(sections.length, "section")}.`}
      </p>

      {matches && matches.length === 0 ? (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">
            <SearchX size={26} />
          </span>
          <h2 style={{ margin: 0 }}>No matching pages</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Nothing in the site map matches “{query.trim()}”. Try a subject code
            such as “DBMS”, a year like “3rd Year”, or a keyword such as
            “questions”.
          </p>
          <div className="row-center mt-md">
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
              Clear filter
            </button>
          </div>
        </div>
      ) : matches ? (
        resultsBySection.map(({ section, items }) => {
          const Icon = section.icon;
          return (
            <section
              className="section sitemap-section"
              key={section.id}
              id={`sitemap-${section.id}`}
            >
              <div className="section-head">
                <h2 className="section-title sitemap-section-title">
                  <Icon size={20} aria-hidden="true" />
                  {section.title}
                </h2>
              </div>
              {renderList(items)}
            </section>
          );
        })
      ) : (
        sections.map((section) => {
          const Icon = section.icon;
          return (
            <section
              className="section sitemap-section"
              key={section.id}
              id={`sitemap-${section.id}`}
            >
              <div className="section-head">
                <h2 className="section-title sitemap-section-title">
                  <Icon size={20} aria-hidden="true" />
                  {section.title}
                </h2>
                {section.note ? (
                  <p className="section-sub">{section.note}</p>
                ) : null}
              </div>

              {section.link ? (
                <p className="sitemap-overview">
                  <Link to={section.link.to}>
                    {section.link.label}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </p>
              ) : null}

              {section.items ? renderList(section.items) : null}

              {(section.groups || []).map((group, gi) => (
                <details className="sitemap-group" key={group.id} open={gi === 0}>
                  <summary>
                    <h3 className="sitemap-group-heading">{group.title}</h3>
                    {group.meta ? (
                      <span className="sitemap-group-meta">{group.meta}</span>
                    ) : null}
                    <ChevronDown
                      className="sitemap-caret"
                      size={16}
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="sitemap-group-body">
                    {renderList(group.items)}
                  </div>
                </details>
              ))}
            </section>
          );
        })
      )}

      <div className="row-center mt-xl">
        <Link className="btn btn-ghost" to="/">
          Back to home
        </Link>
      </div>

      <Footer />
    </main>
  );
}
