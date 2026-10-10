import Footer from "./Footer.jsx";

/**
 * Shared shell for the long-form legal pages (Privacy Policy, Terms &
 * Conditions). Keeps typography, spacing, navigation and footer identical to
 * the rest of the site, and constrains the text to a comfortable reading
 * measure. Content is passed as children as semantic sections.
 */
export default function LegalPage({ eyebrow, title, updated, intro, children }) {
  return (
    <main className="page-main">
      <article className="legal">
        <header className="legal-head">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="legal-title">{title}</h1>
          {intro ? <p className="legal-intro">{intro}</p> : null}
          {updated ? (
            <p className="legal-updated">Last updated: {updated}</p>
          ) : null}
        </header>

        {children}
      </article>

      <Footer />
    </main>
  );
}
