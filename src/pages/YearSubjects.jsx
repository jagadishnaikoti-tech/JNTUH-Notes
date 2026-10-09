import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { getResourceByFolderId, getYear } from "../data/site.js";
import SubjectCard from "../components/SubjectCard.jsx";
import NotFound from "./NotFound.jsx";

export default function YearSubjects() {
  const { yearId } = useParams();
  const year = getYear(yearId);

  if (!year) return <NotFound />;

  const linkedSubjects = year.subjects.filter(
    (s) => !s.disabled && s.folderId
  ).length;

  return (
    <main className="page-main">
      <div className="section-head">
        <div>
          <p className="eyebrow">Subjects</p>
          <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
            {year.name}
          </h1>
        </div>
        <p className="section-sub">{linkedSubjects} subjects available</p>
      </div>

      <div className="subject-grid">
        {year.subjects.map((subject) => (
          <SubjectCard key={subject.label} subject={subject} yearId={year.id} />
        ))}
      </div>

      {year.extras.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Important &amp; previous papers</h2>
          </div>
          <div className="chip-row">
            {year.extras.map((extra) => {
              const resource = getResourceByFolderId(extra.folderId);
              if (!resource) return null;
              return (
                <Link
                  className="chip"
                  key={extra.label}
                  to={`/subject/year${year.id}/${extra.folderId}`}
                >
                  <FileQuestion size={16} aria-hidden="true" />
                  {extra.label}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="row-center mt-xl">
        <Link className="btn btn-ghost" to="/years">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to year selection
        </Link>
      </div>
    </main>
  );
}
