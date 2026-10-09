import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { CODE_LINKS } from "../data/site.js";
import Footer from "../components/Footer.jsx";

export default function LearnCode() {
  return (
    <main className="page-main">
      <div className="section-head">
        <div>
          <p className="eyebrow">CODING</p>
          <h1 className="section-title" style={{ fontSize: "var(--text-3xl)" }}>
            Explore the Tech World
          </h1>
        </div>
        <p className="section-sub">
          Notes, roadmaps, interview prep and placement resources.
        </p>
      </div>

      <div className="quick-grid">
        {CODE_LINKS.map((link) => (
          <a
            className="quick-card"
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="quick-card-icon" aria-hidden="true">
              <ExternalLink size={20} />
            </span>
            <span>
              <span className="quick-card-title">{link.label}</span>
              <span className="quick-card-desc">
                Opens in a new tab
              </span>
            </span>
          </a>
        ))}
      </div>

      <div className="row-center mt-xl">
        <Link className="btn btn-ghost" to="/years">
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Link>
      </div>

      <Footer />
    </main>
  );
}
