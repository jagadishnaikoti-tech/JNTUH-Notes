import { Link } from "react-router-dom";
import {
  BookOpen,
  Bot,
  ClipboardList,
  Code2,
  FolderOpen,
  GraduationCap,
  Home as HomeIcon,
  MessageSquare,
  Search,
  Trophy,
  Upload,
} from "lucide-react";
import { LINKS, SITE, YEARS, getYearStats } from "../data/site.js";

const QUICK_LINKS = [
  { label: "Home", to: "/", icon: HomeIcon },
  { label: "Subjects by year", to: "/years", icon: GraduationCap },
  { label: "Learn Code", to: "/code", icon: Code2 },
  { label: "Search", to: "/search", icon: Search },
];

/**
 * Site-wide footer. Every link below points at a real route or an original
 * (unchanged) external destination from src/data/site.js - no invented pages,
 * contact details or social profiles.
 */
export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link className="footer-brand-row" to="/" title={`${SITE.heading} — Home`}>
            <span className="footer-brand-mark" aria-hidden="true">
              <BookOpen size={20} />
            </span>
            <span className="footer-brand-name">{SITE.heading}</span>
          </Link>
          <p className="footer-desc">
            Your study companion for organized academic notes and learning
            resources.
          </p>
          <ul className="footer-meta">
            {SITE.meta.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <nav className="footer-col" aria-label="Quick links">
          <h2 className="footer-heading">Quick links</h2>
          <ul className="footer-list">
            {QUICK_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link to={item.to}>
                    <Icon size={15} aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <nav className="footer-col" aria-label="Study resources">
          <h2 className="footer-heading">Study resources</h2>
          <ul className="footer-list">
            {YEARS.map((y) => {
              const stats = getYearStats(y);
              return (
                <li key={y.id}>
                  <Link to={`/year/${y.id}`}>
                    <GraduationCap size={15} aria-hidden="true" />
                    {y.name}
                    <span className="footer-note">{stats.subjects} subjects</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <a
                href={LINKS.r22Syllabus}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ClipboardList size={15} aria-hidden="true" />
                R22 Syllabus Copy
              </a>
            </li>
            <li>
              <a href={LINKS.r18} target="_blank" rel="noopener noreferrer">
                <FolderOpen size={15} aria-hidden="true" />
                R18 pdf&apos;s
              </a>
            </li>
          </ul>
        </nav>

        <nav className="footer-col" aria-label="Support">
          <h2 className="footer-heading">Support</h2>
          <ul className="footer-list">
            <li>
              <a href={LINKS.feedback} target="_blank" rel="noopener noreferrer">
                <MessageSquare size={15} aria-hidden="true" />
                Give us Feedback
              </a>
            </li>
            <li>
              <a href={LINKS.updatePdfs} target="_blank" rel="noopener noreferrer">
                <Upload size={15} aria-hidden="true" />
                Update Pdfs
              </a>
            </li>
            <li>
              <a href={LINKS.cseBot} target="_blank" rel="noopener noreferrer">
                <Bot size={15} aria-hidden="true" />
                CSE Pdfs bot
              </a>
            </li>
            <li>
              <a href={LINKS.results} target="_blank" rel="noopener noreferrer">
                <Trophy size={15} aria-hidden="true" />
                Check Results
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="footer-bottom">
        <p className="footer-copy">
          © {year} {SITE.heading}. All rights reserved.
        </p>
        <p className="footer-dev">
          Developed by <strong>Jagadish</strong>
        </p>
      </div>
    </footer>
  );
}
