import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SearchX } from "lucide-react";
import { SITE } from "../data/site.js";
import { SUBJECT_INDEX, FILE_INDEX } from "../data/searchIndex.js";
import DocumentCard from "../components/DocumentCard.jsx";
import PdfViewer from "../components/PdfViewer.jsx";

const MAX_RESULTS = 200;

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") || "").trim();
  const [preview, setPreview] = useState(null);

  const { subjects, files, truncated } = useMemo(() => {
    if (!q) return { subjects: [], files: [], truncated: false };
    const needle = q.toLowerCase();
    const subjects = SUBJECT_INDEX.filter(
      (s) =>
        s.label.toLowerCase().includes(needle) ||
        s.yearName.toLowerCase().includes(needle)
    );
    const all = FILE_INDEX.filter(
      (f) =>
        f.title.toLowerCase().includes(needle) ||
        f.path.toLowerCase().includes(needle)
    );
    return {
      subjects,
      files: all.slice(0, MAX_RESULTS),
      truncated: all.length > MAX_RESULTS,
    };
  }, [q]);

  const total = subjects.length + files.length;

  return (
    <main className="page-main">
      <div className="section-head">
        <div>
          <p className="eyebrow">
            {SUBJECT_INDEX.length} subjects • {FILE_INDEX.length} documents
          </p>
          <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
            Search
          </h1>
        </div>
      </div>

      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="searchbar" style={{ maxWidth: 560 }}>
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="search-input">
            Search subjects and documents
          </label>
          <input
            id="search-input"
            className="searchbar-input"
            type="search"
            autoFocus
            value={q}
            placeholder={SITE.searchPlaceholder}
            onChange={(e) =>
              setParams(e.target.value ? { q: e.target.value } : {}, {
                replace: true,
              })
            }
          />
        </div>
      </form>

      {!q ? (
        <div className="empty-state mt-lg" role="status">
          <span className="empty-state-icon" aria-hidden="true">
            <Search size={26} />
          </span>
          <h2 style={{ margin: 0 }}>Start typing to search</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Search a subject name (for example “DBMS”, “OS”, “ML”) or a document
            name across all {SUBJECT_INDEX.length} subjects and{" "}
            {FILE_INDEX.length} documents.
          </p>
        </div>
      ) : (
        <>
          <p className="muted mt-md" role="status">
            {total} result{total === 1 ? "" : "s"} for “{q}”
          </p>

          {subjects.length > 0 ? (
            <section className="section" style={{ marginTop: "var(--space-lg)" }}>
              <div className="section-head">
                <h2 className="section-title" style={{ fontSize: "var(--text-xl)" }}>
                  Subjects
                </h2>
              </div>
              <div className="subject-grid">
                {subjects.map((s) => (
                  <Link
                    key={`${s.yearId}-${s.label}`}
                    className="subject-card"
                    to={`/subject/year${s.yearId}/${s.folderId}`}
                  >
                    <span className="subject-card-body">
                      <span className="subject-name">{s.label}</span>
                      <span className="subject-count">{s.yearName}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {files.length > 0 ? (
            <section className="section" style={{ marginTop: "var(--space-lg)" }}>
              <div className="section-head">
                <h2 className="section-title" style={{ fontSize: "var(--text-xl)" }}>
                  Documents
                </h2>
              </div>
              <div className="doc-grid">
                {files.map((f) => (
                  <DocumentCard
                    key={`${f.subjectFolderId}-${f.fileId}`}
                    file={f}
                    onPreview={setPreview}
                    showSubject
                  />
                ))}
              </div>
            </section>
          ) : null}

          {truncated ? (
            <p className="notice">
              Showing the first {MAX_RESULTS} matching documents. Narrow your
              search to see more specific results.
            </p>
          ) : null}

          {total === 0 ? (
            <div className="empty-state" role="alert">
              <span className="empty-state-icon" aria-hidden="true">
                <SearchX size={26} />
              </span>
              <h2 style={{ margin: 0 }}>No matches found</h2>
              <p className="muted" style={{ marginTop: 8 }}>
                No subjects or documents match “{q}”. Try a different keyword.
              </p>
              <Link className="btn btn-ghost btn-sm" to="/years">
                Browse subjects by year
              </Link>
            </div>
          ) : null}
        </>
      )}

      {preview ? (
        <PdfViewer file={preview} onClose={() => setPreview(null)} />
      ) : null}
    </main>
  );
}
