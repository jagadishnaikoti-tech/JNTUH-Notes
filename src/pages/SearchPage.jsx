import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Download,
  Eye,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  GraduationCap,
  Presentation,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { SITE } from "../data/site.js";
import {
  CATEGORY_LABELS,
  SEARCH_TOTALS,
  formatBytes,
  highlightParts,
  searchResources,
} from "../lib/search.js";
import PdfViewer from "../components/PdfViewer.jsx";
import Footer from "../components/Footer.jsx";

const EXT_ICON = {
  pdf: FileText,
  doc: FileSpreadsheet,
  docx: FileSpreadsheet,
  rtf: FileText,
  txt: FileText,
  ppt: Presentation,
  pptx: Presentation,
  jpg: FileImage,
  jpeg: FileImage,
  png: FileImage,
  gif: FileImage,
  webp: FileImage,
  mp4: FileVideo,
  mp3: FileVideo,
  zip: FileArchive,
};

const EXAMPLES = ["DBMS", "Machine Learning", "Unit 2", "Important questions", "2 marks", "Java"];

/** Safe highlighter - renders matched segments as <mark>, no raw HTML. */
function Highlight({ text, tokens }) {
  const parts = highlightParts(text, tokens);
  return parts.map((part, i) =>
    part.match ? (
      <mark key={i} className="hl">
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    )
  );
}

const ResultRow = memo(function ResultRow({
  record,
  index,
  active,
  highlightTokens,
  onActivate,
  onPreview,
}) {
  const isSubject = record.kind === "subject";
  const Icon = isSubject
    ? BookOpen
    : EXT_ICON[record.ext] || (record.category === "media" ? FileImage : File);

  const meta = isSubject
    ? [record.context, `${record.count} ${record.count === 1 ? "file" : "files"}`]
        .filter(Boolean)
        .join(" • ")
    : [
        record.subject,
        record.context,
        CATEGORY_LABELS[record.category],
        formatBytes(record.bytes),
      ]
        .filter(Boolean)
        .join(" • ");

  const inner = (
    <>
      <span className="result-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="result-body">
        <span className="result-title">
          <Highlight text={record.title} tokens={highlightTokens} />
        </span>
        <span className="result-meta">{meta}</span>
      </span>
      <span className="result-kind">
        {isSubject ? "Subject" : CATEGORY_LABELS[record.category]}
      </span>
    </>
  );

  return (
    <li
      className={"result-row" + (active ? " is-active" : "")}
      onMouseEnter={() => onActivate(index)}
    >
      {isSubject ? (
        <Link
          className="result-primary"
          to={record.to}
          data-index={index}
        >
          {inner}
        </Link>
      ) : (
        <a
          className="result-primary"
          href={record.url || record.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-index={index}
        >
          {inner}
        </a>
      )}

      {!isSubject ? (
        <div className="result-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onPreview(record)}
          >
            <Eye size={14} aria-hidden="true" />
            Preview
          </button>
          <Link className="btn btn-ghost btn-sm" to={record.to}>
            <BookOpen size={14} aria-hidden="true" />
            Subject
          </Link>
          <a
            className="btn btn-ghost btn-sm"
            href={record.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={14} aria-hidden="true" />
            Download
          </a>
        </div>
      ) : null}
    </li>
  );
});

function EmptySearch({ onPick }) {
  return (
    <div className="empty-state mt-lg" role="status">
      <span className="empty-state-icon" aria-hidden="true">
        <Search size={26} />
      </span>
      <h2 style={{ margin: 0 }}>Start typing to search</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Search across {SEARCH_TOTALS.subjects} subjects and{" "}
        {SEARCH_TOTALS.files} documents: subject names, document titles,
        file names, years and units.
      </p>
      <p className="search-tagline muted">{SITE.searchPlaceholder}</p>
      <div className="chip-row" style={{ justifyContent: "center" }}>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            onClick={() => onPick(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoResults({ query, hasFilters, onClear, onReset }) {
  return (
    <div className="empty-state" role="alert">
      <span className="empty-state-icon" aria-hidden="true">
        <SearchX size={26} />
      </span>
      <h2 style={{ margin: 0 }}>No matches found</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Nothing matches “{query}”
        {hasFilters ? " with the current filters" : ""}. Try a different keyword
        or a shorter one.
      </p>
      <div className="row-center mt-md">
        {hasFilters ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
            Clear filters
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear search
        </button>
        <Link className="btn btn-primary btn-sm" to="/years">
          <GraduationCap size={16} aria-hidden="true" />
          Browse subjects
        </Link>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";

  const [type, setType] = useState("all");
  const [yearId, setYearId] = useState("all");
  const [subject, setSubject] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [preview, setPreview] = useState(null);

  const inputRef = useRef(null);

  const results = useMemo(
    () => searchResources(q, { type, yearId, subject, sort }),
    [q, type, yearId, subject, sort]
  );

  const flat = results.all;
  const indexById = useMemo(() => {
    const map = new Map();
    flat.forEach((record, i) => map.set(record.id, i));
    return map;
  }, [flat]);

  // Reset the active row whenever the result set or filters change.
  useEffect(() => {
    setActiveIndex(-1);
  }, [q, type, yearId, subject, sort]);

  // Drop filter selections that no longer exist for the current query.
  const { facets } = results;
  useEffect(() => {
    if (type !== "all" && !facets.types.includes(type)) setType("all");
    if (yearId !== "all" && !facets.years.some((y) => y.id === String(yearId)))
      setYearId("all");
    if (subject !== "all" && !facets.subjects.includes(subject))
      setSubject("all");
  }, [facets, type, yearId, subject]);

  const setQuery = useCallback(
    (value) => {
      setParams(value ? { q: value } : {}, { replace: true });
    },
    [setParams]
  );

  const clearQuery = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, [setQuery]);

  const resetFilters = useCallback(() => {
    setType("all");
    setYearId("all");
    setSubject("all");
    setSort("relevance");
  }, []);

  const onActivate = useCallback((i) => setActiveIndex(i), []);
  const onPreview = useCallback((file) => setPreview(file), []);

  const resultLinks = useCallback(
    () => Array.from(document.querySelectorAll(".result-primary")),
    []
  );

  const focusResult = useCallback(
    (i) => {
      const target = resultLinks()[i];
      if (target) {
        target.focus();
        setActiveIndex(i);
      }
    },
    [resultLinks]
  );

  const onKeyDown = useCallback(
    (e) => {
      const tag = e.target?.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowDown") {
        if (!flat.length) return;
        e.preventDefault();
        const links = resultLinks();
        const current = links.indexOf(document.activeElement);
        focusResult(current < 0 ? 0 : Math.min(current + 1, links.length - 1));
      } else if (e.key === "ArrowUp") {
        if (!flat.length) return;
        e.preventDefault();
        const current = resultLinks().indexOf(document.activeElement);
        if (current <= 0) {
          setActiveIndex(-1);
          inputRef.current?.focus();
        } else {
          focusResult(current - 1);
        }
      } else if (e.key === "Escape") {
        if (q) {
          e.preventDefault();
          clearQuery();
        }
      } else if (e.key === "Enter") {
        // Open the active (or first) result straight from the input.
        if (e.target === inputRef.current && flat.length) {
          e.preventDefault();
          const links = resultLinks();
          (links[activeIndex >= 0 ? activeIndex : 0] || links[0])?.click();
        }
      }
    },
    [flat.length, activeIndex, resultLinks, focusResult, q, clearQuery]
  );

  const { subjects, files, total, truncated, highlightTokens } = results;
  const hasFilters =
    type !== "all" || yearId !== "all" || subject !== "all";

  return (
    <main className="page-main" onKeyDown={onKeyDown}>
      <div className="section-head">
        <div>
          <p className="eyebrow">
            {SEARCH_TOTALS.subjects} subjects • {SEARCH_TOTALS.files} documents
          </p>
          <h1 className="section-title search-title">Search</h1>
        </div>
      </div>

      <div className="search-panel">
        <div className="search-input">
          <Search size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor="search-input">
            Search subjects, units, topics and PDFs
          </label>
          <input
            ref={inputRef}
            id="search-input"
            className="search-input-field"
            type="search"
            autoFocus
            autoComplete="off"
            value={q}
            placeholder="Search subjects, units, topics and PDFs…"
            aria-describedby="search-hint"
            onChange={(e) => setQuery(e.target.value)}
          />
          {q ? (
            <button
              type="button"
              className="search-clear"
              onClick={clearQuery}
              aria-label="Clear search"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <p className="search-hint" id="search-hint">
          Press <kbd>/</kbd> to focus, <kbd>Esc</kbd> to clear,{" "}
          <kbd>↑</kbd>
          <kbd>↓</kbd> to browse results
        </p>

        {q ? (
          <div className="search-filters">
            <label className="filter-field">
              <span className="filter-label">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">All types</option>
                {facets.types
                  .filter((v) => v !== "all")
                  .map((v) => (
                    <option key={v} value={v}>
                      {CATEGORY_LABELS[v] || v}
                    </option>
                  ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Year</span>
              <select
                value={yearId}
                onChange={(e) => setYearId(e.target.value)}
                disabled={facets.years.length === 0}
              >
                <option value="all">All years</option>
                {facets.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Subject</span>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={facets.subjects.length === 0}
              >
                <option value="all">All subjects</option>
                {facets.subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="relevance">Relevance</option>
                <option value="title">Title (A to Z)</option>
              </select>
            </label>

            {hasFilters || sort !== "relevance" ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm filter-reset"
                onClick={resetFilters}
              >
                Reset
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!q ? (
        <EmptySearch onPick={setQuery} />
      ) : (
        <>
          <p className="search-count muted" role="status" aria-live="polite">
            {total === 0
              ? `No results for “${q}”`
              : `${total} result${total === 1 ? "" : "s"} for “${q}”`}
            {hasFilters ? " · filtered" : ""}
          </p>

          {total === 0 ? (
            <NoResults
              query={q}
              hasFilters={hasFilters}
              onClear={clearQuery}
              onReset={resetFilters}
            />
          ) : (
            <>
              {subjects.length > 0 ? (
                <section className="result-section">
                  <h2 className="result-heading">
                    Subjects
                    <span className="result-heading-count">
                      {subjects.length}
                    </span>
                  </h2>
                  <ul className="result-list" aria-label="Subject results">
                    {subjects.map((record) => (
                      <ResultRow
                        key={record.id}
                        record={record}
                        index={indexById.get(record.id)}
                        active={indexById.get(record.id) === activeIndex}
                        highlightTokens={highlightTokens}
                        onActivate={onActivate}
                        onPreview={onPreview}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {files.length > 0 ? (
                <section className="result-section">
                  <h2 className="result-heading">
                    Documents
                    <span className="result-heading-count">{files.length}</span>
                  </h2>
                  <ul className="result-list" aria-label="Document results">
                    {files.map((record) => (
                      <ResultRow
                        key={record.id}
                        record={record}
                        index={indexById.get(record.id)}
                        active={indexById.get(record.id) === activeIndex}
                        highlightTokens={highlightTokens}
                        onActivate={onActivate}
                        onPreview={onPreview}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {truncated ? (
                <p className="notice">
                  Showing the first {flat.length} of {total} matches. Narrow your
                  search or use the filters to see more specific results.
                </p>
              ) : null}
            </>
          )}
        </>
      )}

      {preview ? (
        <PdfViewer file={preview} onClose={() => setPreview(null)} />
      ) : null}

      <Footer />
    </main>
  );
}
