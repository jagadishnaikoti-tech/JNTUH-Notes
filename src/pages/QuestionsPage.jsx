import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  GraduationCap,
  Inbox,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";
import {
  GUARANTEE_QNS_EXTERNAL,
  getQuestionCategory,
  getQuestionSets,
  getQuestionYears,
} from "../data/questions.js";
import { LINKS, SITE, YEARS, getResource } from "../data/site.js";
import Footer from "../components/Footer.jsx";
import PdfViewer from "../components/PdfViewer.jsx";
import NotFound from "./NotFound.jsx";

const PREVIEWABLE_EXT = new Set(["pdf", "doc", "docx", "rtf", "txt", "ppt", "pptx"]);

function formatBytes(bytes) {
  if (!bytes) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function QuestionSetRow({ item, onPreview }) {
  const ext = (item.ext || "").toLowerCase();
  const previewable = PREVIEWABLE_EXT.has(ext);

  return (
    <li
      className="qs-item"
      data-doc-id={item.fileId || ""}
      data-doc-title={item.title}
      data-doc-subject={item.subject || ""}
      data-doc-year={item.yearName || ""}
      data-doc-year-id={item.yearId != null ? String(item.yearId) : ""}
    >
      <span className={`qs-ext qs-ext-${ext || "file"}`} aria-hidden="true">
        {ext ? ext.toUpperCase() : "FILE"}
      </span>

      <div className="qs-item-body">
        <a
          className="qs-item-title"
          href={item.url}
          data-doc-action="open"
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.title}
        </a>
        <p className="qs-item-meta">
          <span>{item.subject}</span>
          <span aria-hidden="true">·</span>
          <span>{item.yearName}</span>
          {item.unit ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.unit}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="qs-item-actions">
        {previewable ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-doc-action="view"
            onClick={() => onPreview(item)}
          >
            <Eye size={15} aria-hidden="true" />
            Preview
          </button>
        ) : null}
        {item.subjectFolderPath ? (
          <Link className="btn btn-ghost btn-sm" to={item.subjectFolderPath}>
            <FolderOpen size={15} aria-hidden="true" />
            Subject folder
          </Link>
        ) : null}
        <a
          className="btn btn-primary btn-sm"
          href={item.downloadUrl}
          data-doc-action="download"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={15} aria-hidden="true" />
          Download
        </a>
      </div>
    </li>
  );
}

export default function QuestionsPage() {
  const { category: categoryId } = useParams();
  const category = getQuestionCategory(categoryId);
  const [yearFilter, setYearFilter] = useState("all");
  const [preview, setPreview] = useState(null);

  const sets = useMemo(
    () => (category ? getQuestionSets(category.id) : []),
    [category]
  );
  const years = useMemo(
    () => (category ? getQuestionYears(category.id) : []),
    [category]
  );

  // Real year-level "Important Questions" folders that have files (existing
  // routes under /subject/... — reused rather than duplicated).
  const questionFolders = useMemo(() => {
    if (!category || category.id !== "guaranteed") return [];
    return YEARS.map((year) => {
      const resource = getResource(`year${year.id}`, "Important Questions");
      if (!resource || !resource.stats || resource.stats.files === 0) return null;
      return {
        yearId: year.id,
        yearName: year.name,
        folderId: resource.folderId,
        files: resource.stats.files,
      };
    }).filter(Boolean);
  }, [category]);

  if (!category) return <NotFound />;

  const filtered =
    yearFilter === "all"
      ? sets
      : sets.filter((set) => set.yearId === Number(yearFilter));

  const groups = years
    .filter((row) => yearFilter === "all" || row.year.id === Number(yearFilter))
    .map((row) => ({
      ...row,
      items: filtered.filter((set) => set.yearId === row.year.id),
    }))
    .filter((row) => row.items.length > 0);

  const showFilters = years.length > 1;

  return (
    <main className="page-main">
      <section>
        <div className="section-head">
          <div>
            <p className="eyebrow">Exam Preparation</p>
            <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
              {category.title}
            </h1>
            <p className="section-sub" style={{ marginTop: 4 }}>
              {category.description}
            </p>
            <ul className="qs-meta">
              {SITE.meta
                .filter((m) => /reg|branch|course/i.test(m))
                .map((m) => (
                  <li key={m}>{m}</li>
                ))}
            </ul>
          </div>
          <div className="qs-count" aria-label={`${sets.length} question sets`}>
            <span className="qs-count-value">{sets.length}</span>
            <span className="qs-count-label">
              question set{sets.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {category.id === "guaranteed" ? (
          <div className="qs-callout">
            <span className="qs-callout-icon" aria-hidden="true">
              <Sparkles size={20} />
            </span>
            <div className="qs-callout-body">
              <strong>Live guaranteed-questions tool</strong>
              <p>
                The original <em>GUARNTEE QNS</em> app from the reference site
                is still online. Pick a subject and fetch curated questions
                instantly.
              </p>
            </div>
            <a
              className="btn btn-secondary btn-sm"
              href={GUARANTEE_QNS_EXTERNAL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open JNTUH-IQ
            </a>
          </div>
        ) : null}

        {showFilters ? (
          <div
            className="chip-row qs-chips"
            role="group"
            aria-label="Filter question sets by year"
          >
            <button
              type="button"
              className={`chip qs-chip ${yearFilter === "all" ? "is-active" : ""}`}
              aria-pressed={yearFilter === "all"}
              onClick={() => setYearFilter("all")}
            >
              All years
            </button>
            {years.map((row) => (
              <button
                type="button"
                key={row.year.id}
                className={`chip qs-chip ${
                  yearFilter === String(row.year.id) ? "is-active" : ""
                }`}
                aria-pressed={yearFilter === String(row.year.id)}
                onClick={() => setYearFilter(String(row.year.id))}
              >
                {row.year.name}
                <span className="qs-chip-count">{row.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {sets.length === 0 ? (
          <div className="empty-state qs-empty" role="status">
            <span className="empty-state-icon" aria-hidden="true">
              <Inbox size={26} />
            </span>
            <h2 style={{ margin: 0 }}>No question sets published yet</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              There is no {category.title.toLowerCase()} material in the
              resource inventory yet. Request it below and we will add it as
              soon as it is published.
            </p>
            <div className="row-center mt-md">
              <a
                className="btn btn-primary"
                href={LINKS.feedback}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircleQuestion size={16} aria-hidden="true" />
                Request material
              </a>
            </div>
          </div>
        ) : (
          groups.map(({ year, items }) => (
            <section key={year.id} className="qs-year">
              <div className="qs-year-head">
                <h2 className="qs-year-title">
                  <GraduationCap size={18} aria-hidden="true" />
                  {year.name}
                  <span className="qs-count-badge">{items.length}</span>
                </h2>
              </div>
              <ul className="qs-list">
                {items.map((item) => (
                  <QuestionSetRow
                    key={item.id}
                    item={item}
                    onPreview={setPreview}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {category.id === "short" && sets.length > 0 && sets.length < 4 ? (
          <div className="notice qs-notice">
            Only {sets.length} short-question set
            {sets.length === 1 ? " is" : "s are"} published right now. More
            subjects are being prepared.{" "}
            <a
              href={LINKS.feedback}
              target="_blank"
              rel="noopener noreferrer"
            >
              let us know which subject you need
            </a>
            .
          </div>
        ) : null}

        {questionFolders.length > 0 ? (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title" style={{ fontSize: "var(--text-xl)" }}>
                Browse complete question folders
              </h2>
              <p className="section-sub">
                Year-level "Important Questions" folders on Google Drive.
              </p>
            </div>
            <div className="chip-row">
              {questionFolders.map((f) => (
                <Link
                  key={f.yearId}
                  className="chip"
                  to={`/subject/year${f.yearId}/${f.folderId}`}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                  {f.yearName} · Important Questions ({f.files})
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="row-center mt-xl">
          <Link className="btn btn-ghost" to="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to home
          </Link>
          <Link className="btn btn-ghost" to="/years">
            <GraduationCap size={16} aria-hidden="true" />
            Browse by year
          </Link>
        </div>
      </section>

      {preview ? (
        <PdfViewer file={preview} onClose={() => setPreview(null)} />
      ) : null}

      <Footer />
    </main>
  );
}