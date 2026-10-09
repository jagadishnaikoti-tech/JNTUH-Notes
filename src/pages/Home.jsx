import { Link } from "react-router-dom";
import {
  Award,
  Bot,
  ClipboardList,
  Code2,
  FolderOpen,
  GraduationCap,
  Trophy,
} from "lucide-react";
import {
  CODE_LINKS,
  LINKS,
  SITE,
  YEARS,
  getYearStats,
  resources,
} from "../data/site.js";
import SearchBar from "../components/SearchBar.jsx";
import Footer from "../components/Footer.jsx";

const QUICK_LINKS = [
  {
    label: "R22 Syllabus Copy CSE & AIML",
    desc: "The official R22 syllabus for CSE & AIML.",
    href: LINKS.r22Syllabus,
    icon: ClipboardList,
  },
  {
    label: "R18 pdf's",
    desc: "Legacy R18 study material folder.",
    href: LINKS.r18,
    icon: FolderOpen,
  },
  {
    label: "GUARNTEE QNS",
    desc: "Guaranteed questions to revise before exams.",
    href: LINKS.guaranteeQns,
    icon: Award,
  },
  {
    label: "CSE Pdfs bot",
    desc: "Get additional PDFs on Telegram.",
    href: LINKS.cseBot,
    icon: Bot,
  },
  {
    label: "Check Results",
    desc: "JNTUH academic results portal.",
    href: LINKS.results,
    icon: Trophy,
  },
  {
    label: "Learn Code",
    desc: "Coding notes, roadmaps & placement prep.",
    to: "/code",
    icon: Code2,
  },
];

export default function Home() {
  return (
    <main className="page-main">
      <section className="hero">
        <span className="hero-eyebrow">
          {SITE.brand} {SITE.brandEmoji}
        </span>
        <h1 className="hero-title">{SITE.heading}</h1>
        <p className="hero-tagline">{SITE.tagline}</p>

        <ul className="hero-meta">
          {SITE.meta.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>

        <div className="hero-actions">
          <Link className="btn btn-primary" to="/years">
            <GraduationCap size={18} aria-hidden="true" />
            Get Started
          </Link>
          <a
            className="btn btn-secondary"
            href={LINKS.results}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Trophy size={18} aria-hidden="true" />
            Check Results
          </a>
        </div>

        <p className="hero-note">{SITE.navNote}</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Find your material</h2>
          <p className="section-sub">
            Search across {resources.totals.files} documents and {YEARS.length}{" "}
            years of subjects.
          </p>
        </div>
        <SearchBar id="home-search" />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Browse by year</h2>
          <p className="section-sub">
            Every subject links straight to its original Google Drive folder.
          </p>
        </div>

        <div className="year-grid">
          {YEARS.map((year) => {
            const stats = getYearStats(year);
            return (
              <Link className="year-card" to={`/year/${year.id}`} key={year.id}>
                <span className="year-card-icon" aria-hidden="true">
                  <FolderOpen size={22} />
                </span>
                <h3 className="year-card-title">{year.name}</h3>
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
          <h2 className="section-title">Study material &amp; tools</h2>
          <p className="section-sub">
            Quick access to the resources linked from the original site.
          </p>
        </div>

        <div className="quick-grid">
          {QUICK_LINKS.map((item) => {
            const Icon = item.icon;
            const inner = (
              <>
                <span className="quick-card-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span>
                  <span className="quick-card-title">{item.label}</span>
                  <span className="quick-card-desc">{item.desc}</span>
                </span>
              </>
            );
            return item.to ? (
              <Link className="quick-card" to={item.to} key={item.label}>
                {inner}
              </Link>
            ) : (
              <a
                className="quick-card"
                href={item.href}
                key={item.label}
                target="_blank"
                rel="noopener noreferrer"
              >
                {inner}
              </a>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Coding &amp; placement</h2>
          <p className="section-sub">
            Resources from the Learn Code section.
          </p>
        </div>
        <div className="chip-row">
          {CODE_LINKS.map((link) => (
            <a
              className="chip"
              href={link.url}
              key={link.label}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
