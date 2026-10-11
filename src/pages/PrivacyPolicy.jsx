import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import LegalPage from "../components/LegalPage.jsx";
import { LINKS } from "../data/site.js";

/**
 * Privacy Policy.
 *
 * The wording below describes what this frontend actually does, verified from
 * the source: a static React single-page app that offers optional student
 * accounts (Firebase Authentication + Cloud Firestore), first-party anonymous
 * analytics, and links to documents hosted on other services. Points that the
 * site owner must confirm before publication are flagged in the review block.
 */
export default function PrivacyPolicy() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="12 October 2026"
      intro="This policy explains what information the JNTUH Notes website stores or processes when you use it. JNTUH Notes is a free, non-commercial study-material website that links to documents published on other services. Reading and downloading the study material never requires an account."
    >
      <section className="legal-section">
        <h2>Introduction</h2>
        <p>
          JNTUH Notes ("this website", "we") is a front-end study-resource
          website for B.Tech CSE &amp; AIML students following the JNTUH R22
          regulation. It provides organised links to notes, question sets and
          question papers. You can use the whole library without an account;
          creating an account is optional.
        </p>
        <p>
          The website is served as a static application on Vercel. It has no
          application server of its own. Account sign-in, the optional profile
          and the analytics described below are provided by Google Firebase and
          Google Analytics.
        </p>
      </section>

      <section className="legal-section">
        <h2>Account information</h2>
        <p>
          If you choose to create an account, we collect and store:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Your name</strong> - the display name you enter, shown in
            the site header while you are signed in.
          </li>
          <li>
            <strong>Your email address</strong> - used to sign you in and, if
            you request it, to send a password-reset link.
          </li>
          <li>
            <strong>Basic account record</strong> - when the account was created
            and last updated.
          </li>
        </ul>
        <p>
          Your password is handled entirely by Firebase Authentication. It is
          never written to our own storage, is never stored in the browser by
          this website, and is not visible to us.
        </p>
        <p>
          Account information is stored in Google Firebase (Authentication and
          Cloud Firestore) and is used only to sign you in, keep your session,
          show your name, and let you manage your own account. It is never sold
          or shared for advertising. Creating an account grants no special
          access - it does not make you an administrator.
        </p>
      </section>

      <section className="legal-section">
        <h2>Information we collect automatically</h2>
        <p>
          We record a small amount of anonymous usage information so we can see
          which subjects and documents are useful:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Page views</strong> - the page address and title.
          </li>
          <li>
            <strong>Document interactions</strong> - which notes or question
            paper you preview or open, and the page you opened it from.
          </li>
        </ul>
        <p>
          These records carry a random, anonymous identifier kept in your
          browser (not your name, email or IP address) and a per-visit session
          identifier, so visits can be counted without identifying anyone. We do
          not record IP addresses, user-agent strings or any information that
          identifies you. This information is never linked to your account.
        </p>
        <p>
          Search terms are processed in your browser and are not sent to us. The
          current search term appears in the page address (for example{" "}
          <code>/search?q=DBMS</code>) so a result can be bookmarked or shared.
        </p>
        <p>
          This website also uses Google Analytics 4 (through Firebase Analytics
          and a Google tag). Google may set its own cookies or identifiers and
          process data as described in Google&apos;s privacy policy. Where
          required, analytics storage stays disabled until you accept the
          on-screen consent notice.
        </p>
      </section>

      <section className="legal-section">
        <h2>How information is used</h2>
        <p>
          Account information is used to sign you in, keep you signed in, show
          your name, and let you update your account. Anonymous usage
          information is used to understand which resources are useful and to
          improve the library. We do not use any of it for advertising, and we
          do not sell it.
        </p>
      </section>

      <section className="legal-section">
        <h2>Cookies and local storage</h2>
        <p>
          The website uses your browser&apos;s <strong>local storage</strong>{" "}
          and <strong>session storage</strong> for the following:
        </p>
        <ul className="legal-list">
          <li>
            <code>ln:sidebar-collapsed</code> - remembers whether the navigation
            sidebar is collapsed.
          </li>
          <li>
            <code>ln:theme</code> - remembers your light/dark choice.
          </li>
          <li>
            <code>ln:analytics-consent</code> - remembers your analytics choice,
            when a consent notice is shown.
          </li>
          <li>
            <code>ln:visitor-id</code> - a random, anonymous identifier used to
            estimate unique visitors.
          </li>
          <li>
            <code>ln:session</code> - a random identifier that lasts for one
            visit.
          </li>
        </ul>
        <p>
          When you sign in, Firebase Authentication also stores the data needed
          to keep your session (for example a token) in your browser. If you
          choose &quot;Keep me signed in&quot;, that session survives a browser
          restart; otherwise it ends when you close the browser. These values
          are kept in your browser and can be removed at any time by clearing
          your browser&apos;s site data or by signing out. Google Analytics may
          set additional cookies of its own.
        </p>
      </section>

      <section className="legal-section">
        <h2>Third-party services</h2>
        <p>
          The website relies on external services, and some load only after you
          choose to interact with them:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Google Firebase</strong> (Authentication, Cloud Firestore
            and Analytics) - handles sign-in, stores your optional profile and
            receives the anonymous usage records described above.
          </li>
          <li>
            <strong>Google Analytics 4</strong> - receives the analytics events
            described above.
          </li>
          <li>
            <strong>Google Drive</strong> - documents open in Google Drive, and
            the in-app preview loads Google&apos;s document viewer in an iframe
            when you click &quot;Preview&quot;.
          </li>
          <li>
            <strong>Google Fonts</strong> - the site&apos;s typefaces are loaded
            from Google&apos;s font service.
          </li>
          <li>
            <strong>Vercel</strong> - hosts and serves the pages to your
            browser.
          </li>
          <li>
            Other outbound links (for example WhatsApp feedback, Telegram, and
            the external guaranteed-questions tool) are opened only when you
            click them.
          </li>
        </ul>
        <p>
          When you use one of these services, its own privacy policy applies. We
          do not control their content or their data practices.
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
          Browser preferences and your sign-in session remain in your browser
          until you clear your browser data or sign out. Account information
          remains in Firebase until you delete the account. Anonymous usage
          records may be kept to show trends over time, but they cannot be
          linked back to you.
        </p>
      </section>

      <section className="legal-section">
        <h2>Security</h2>
        <p>
          The website is served over HTTPS. Sign-in, account data and analytics
          are protected by Google Firebase security rules so that you can read
          and update only your own account information, and only administrators
          can read the site&apos;s analytics. Keep your password private and use
          normal caution when following links to third-party services.
        </p>
      </section>

      <section className="legal-section">
        <h2>Your rights and contact</h2>
        <p>
          You can view and change your display name from your{" "}
          <Link to="/account">account page</Link>, and sign out at any time. To
          request a copy of your account data, to delete your account, or to
          raise a privacy question, use the feedback channel below. Removing a
          linked study document can also be requested there.
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
            Confirm the hosting and Google Firebase/Google Analytics retention
            periods so they can be stated precisely.
          </li>
          <li>
            Confirm whether a cookie/analytics consent notice is required in
            your jurisdiction, and enable it (set{" "}
            <code>VITE_REQUIRE_CONSENT=true</code>) if so.
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
