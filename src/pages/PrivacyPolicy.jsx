import { TriangleAlert } from "lucide-react";
import LegalPage from "../components/LegalPage.jsx";
import { LINKS } from "../data/site.js";

/**
 * Privacy Policy.
 *
 * The wording below describes what this frontend actually does, verified from
 * the source: it is a static React single-page app with no backend, no
 * accounts, no cookies, no analytics and no third-party scripts. The only
 * browser storage is a single UI preference in localStorage. Points that the
 * site owner must confirm before publication are flagged in the review block.
 */
export default function PrivacyPolicy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="10 October 2026"
      intro="This policy explains what information the JNTUH Notes website stores or processes when you use it. JNTUH Notes is a free, non-commercial study-material website that links to documents published on other services."
    >
      <section className="legal-section">
        <h2>Introduction</h2>
        <p>
          JNTUH Notes ("this website", "we") is a front-end study-resource
          website for B.Tech CSE &amp; AIML students following the JNTUH R22
          regulation. It provides organised links to notes, question sets and
          question papers, and does not operate user accounts.
        </p>
        <p>
          This website is served as a static application. It has no application
          server, no database of its own and no sign-in.
        </p>
      </section>

      <section className="legal-section">
        <h2>Information we collect</h2>
        <p>
          This website does not ask for, and does not store, personal
          information such as your name, email address or phone number. There
          are no accounts, no contact forms and no payment features.
        </p>
        <p>
          Search terms are processed entirely in your browser and are not sent
          to us or to any third party. The current search term is reflected in
          the page address (for example <code>/search?q=DBMS</code>) so the
          result can be bookmarked or shared.
        </p>
      </section>

      <section className="legal-section">
        <h2>How information is used</h2>
        <p>
          The only information this website stores is a single display
          preference (see below), used solely to remember whether you collapsed
          the navigation sidebar. It is used to render the interface the way you
          last left it, and for no other purpose.
        </p>
      </section>

      <section className="legal-section">
        <h2>Cookies and local storage</h2>
        <p>
          This website does not set cookies. It uses your browser&apos;s{" "}
          <strong>local storage</strong> to remember one interface preference:
        </p>
        <ul className="legal-list">
          <li>
            <code>ln:sidebar-collapsed</code> - stores <code>"1"</code> or{" "}
            <code>"0"</code> to remember whether the sidebar is collapsed.
          </li>
        </ul>
        <p>
          This value is kept in your browser only, is never transmitted, and can
          be removed at any time by clearing your browser&apos;s site data.
        </p>
      </section>

      <section className="legal-section">
        <h2>Third-party services</h2>
        <p>
          The website links out to external services, and some of them load only
          after you choose to interact with them:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Google Drive</strong> - documents open in Google Drive, and
            the in-app preview loads Google&apos;s document viewer in an iframe
            when you click "Preview".
          </li>
          <li>
            <strong>Hosting</strong> - the site is deployed on Vercel, which
            serves the pages to your browser.
          </li>
          <li>
            Other outbound links (for example WhatsApp feedback, Telegram, and
            the external guaranteed-questions tool) are opened only when you
            click them.
          </li>
        </ul>
        <p>
          When you follow one of these links, the privacy policies of those
          services apply. We do not control their content or their data
          practices, and we do not receive personal data from them.
        </p>
      </section>

      <section className="legal-section">
        <h2>External document links</h2>
        <p>
          Study documents are not stored on this website. Each document is
          hosted on a public Google Drive folder and is opened through its
          original link. Any data collected by Google when you access those
          documents is governed by Google&apos;s privacy policy.
        </p>
      </section>

      <section className="legal-section">
        <h2>Data retention</h2>
        <p>
          The single local-storage preference remains in your browser until you
          clear your browser data or remove it manually. We retain no personal
          data on any server because we do not operate one.
        </p>
      </section>

      <section className="legal-section">
        <h2>Security</h2>
        <p>
          The website is served over HTTPS. Because it stores no personal data
          and has no accounts or backend, there is no personal-data store to
          breach. You should still use normal caution when following links to
          third-party services.
        </p>
      </section>

      <section className="legal-section">
        <h2>Your rights and contact</h2>
        <p>
          Because this website does not store personal information about you,
          there is no personal record to access, correct or delete. To request
          removal of a linked document, or to raise a privacy question, use the
          feedback channel below.
        </p>
        <p>
          Feedback:{" "}
          <a href={LINKS.feedback} target="_blank" rel="noopener noreferrer">
            contact us on WhatsApp
          </a>
          .
        </p>
      </section>

      <section className="legal-section">
        <h2>Changes to this policy</h2>
        <p>
          This policy may be updated as the website changes. The date at the top
          of this page shows when it was last revised.
        </p>
      </section>

      <aside className="legal-review" role="note">
        <h2>
          <TriangleAlert size={18} aria-hidden="true" />
          For the site owner to confirm before publication
        </h2>
        <ul className="legal-list">
          <li>
            Confirm a dedicated contact email address to publish here. This page
            currently points only to the existing WhatsApp feedback link because
            no email address is verified in the project.
          </li>
          <li>
            Confirm whether the hosting provider&apos;s request logs are
            retained, and how long, so this can be stated precisely.
          </li>
          <li>
            Confirm whether any analytics or monitoring service will be added
            before launch. If one is added, this policy must be updated and any
            consent requirements applied.
          </li>
          <li>
            Have the wording reviewed for the data-protection rules that apply
            to you, in the jurisdiction you operate from.
          </li>
        </ul>
      </aside>
    </LegalPage>
  );
}
