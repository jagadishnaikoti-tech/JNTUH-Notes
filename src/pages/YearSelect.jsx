import { Link } from "react-router-dom";
import {
  Award,
  Bot,
  Code2,
  FolderOpen,
  GraduationCap,
} from "lucide-react";
import { LINKS, YEARS, getYearStats } from "../data/site.js";
import Footer from "../components/Footer.jsx";

export default function YearSelect() {
  return (
    <main className="page-main">
      <section>
        <div className="section-head">
          <div>
            <p className="eyebrow">JNTUH Notes</p>
            <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
              Select Year
            </h1>
          </div>
          <p className="section-sub">
            Choose a year to see its subjects and study material.
          </p>
        </div>

        <div className="year-grid">
          {YEARS.map((year) => {
            const stats = getYearStats(year);
            return (
              <Link className="year-card" to={`/year/${year.id}`} key={year.id}>
                <span className="year-card-icon" aria-hidden="true">
                  <GraduationCap size={22} />
                </span>
                <h2 className="year-card-title">{year.name}</h2>
                <p className="year-card-meta">
                  {stats.subjects} subjects • {stats.files} documents
                </p>
                <span className="year-card-cta">Open subjects →</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">More ways to study</h2>
        </div>

        <div className="quick-grid">
          <Link className="quick-card" to="/code">
            <span className="quick-card-icon" aria-hidden="true">
              <Code2 size={20} />
            </span>
            <span>
              <span className="quick-card-title">LEARN CODE</span>
              <span className="quick-card-desc">
                Coding notes, roadmaps &amp; placement.
              </span>
            </span>
          </Link>

          <a
            className="quick-card"
            href={LINKS.guaranteeQns}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="quick-card-icon" aria-hidden="true">
              <Award size={20} />
            </span>
            <span>
              <span className="quick-card-title">GUARNTEE QNS</span>
              <span className="quick-card-desc">
                Guaranteed questions to revise.
              </span>
            </span>
          </a>

          <a
            className="quick-card"
            href={LINKS.cseBot}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="quick-card-icon" aria-hidden="true">
              <Bot size={20} />
            </span>
            <span>
              <span className="quick-card-title">CSE Pdfs bot</span>
              <span className="quick-card-desc">
                Additional PDFs on Telegram.
              </span>
            </span>
          </a>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Syllabus &amp; previous papers</h2>
        </div>

        <p className="notice">
          Note: For More pdf's click above CSE Pdfs bot
        </p>

        <div className="chip-row">
          <a
            className="chip"
            href={LINKS.r18}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FolderOpen size={16} aria-hidden="true" />
            R18 pdf's
          </a>
          <a
            className="chip"
            href={LINKS.r22Syllabus}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FolderOpen size={16} aria-hidden="true" />
            R22 Syllabus Copy CSE &amp; AIML
          </a>
        </div>
      </section>

      <div className="row-center mt-xl">
        <Link className="btn btn-ghost" to="/">
          Back
        </Link>
      </div>

      <Footer />
    </main>
  );
}
