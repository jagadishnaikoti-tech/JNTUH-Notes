import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import LegalPage from "../components/LegalPage.jsx";
import { LINKS } from "../data/site.js";

/**
 * Terms & Conditions.
 *
 * The wording describes the actual service (a non-commercial study link
 * directory). No legal entity, jurisdiction or contact detail is invented;
 * items the owner must supply are flagged in the review block.
 */
export default function TermsConditions() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms & Conditions"
      updated="10 October 2026"
      intro="These terms explain the rules for using the JNTUH Notes website. By accessing or using the website, you agree to them."
    >
      <section className="legal-section">
        <h2>Acceptance of terms</h2>
        <p>
          By visiting or using JNTUH Notes ("this website"), you accept these
          terms and conditions. If you do not agree with them, please do not use
          the website.
        </p>
      </section>

      <section className="legal-section">
        <h2>Website purpose</h2>
        <p>
          JNTUH Notes is a free, non-commercial study website for B.Tech CSE
          &amp; AIML students following the JNTUH R22 regulation. It organises
          links to lecture notes, important and guaranteed question material,
          short questions and previous question papers. It is a resource
          directory; it does not host, sell or grade the material.
        </p>
      </section>

      <section className="legal-section">
        <h2>Educational resource usage</h2>
        <p>
          The material is provided for personal study and academic reference
          only. You may use it to prepare for examinations and coursework. You
          may not present it as your own work where doing so would breach your
          institution&apos;s academic-integrity rules.
        </p>
      </section>

      <section className="legal-section">
        <h2>Accuracy and availability of materials</h2>
        <p>
          We aim to link to useful and accurate material, but we do not
          guarantee that any material is complete, current, error-free or
          suitable for a particular syllabus. Question sets are study aids
          only: no question is guaranteed to appear in any examination, and
          nothing here is an official statement from JNTUH or any university.
        </p>
        <p>
          Documents are hosted on external services and may be moved, changed or
          removed by their owners at any time. Availability is therefore not
          guaranteed.
        </p>
      </section>

      <section className="legal-section">
        <h2>Intellectual property and document ownership</h2>
        <p>
          The original notes, question papers and other documents remain the
          property of their respective authors, faculties, institutions or other
          rights holders. This website does not claim ownership of them. It
          only links to documents that were made publicly available through the
          source folders.
        </p>
        <p>
          If you own a document and want a link to it removed, contact us and we
          will act on a reasonable request.
        </p>
      </section>

      <section className="legal-section">
        <h2>Acceptable use</h2>
        <p>When using the website, you agree not to:</p>
        <ul className="legal-list">
          <li>
            use automated tools to scrape, overload or disrupt the website or the
            external services it links to;
          </li>
          <li>
            attempt to introduce malware, or interfere with the website&apos;s
            normal operation;
          </li>
          <li>
            misrepresent the material as your own, or use it in a way that
            infringes the rights of its owner.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>External links</h2>
        <p>
          The website links to third-party services, including Google Drive,
          WhatsApp and other external tools. Those services are not under our
          control, and we are not responsible for their content, availability,
          security or data practices. Use them at your own discretion and review
          their terms.
        </p>
      </section>

      <section className="legal-section">
        <h2>Limitation of liability</h2>
        <p>
          The website and its links are provided "as is", without warranties of
          any kind. To the fullest extent permitted by applicable law, the
          website is not liable for any loss or damage arising from your use of,
          or reliance on, the material or the external services it links to.
        </p>
      </section>

      <section className="legal-section">
        <h2>Changes to the service and to these terms</h2>
        <p>
          The website and its content may change over time. These terms may also
          be updated; the date at the top of this page shows when they were last
          revised. Continued use after a change means you accept the updated
          terms.
        </p>
      </section>

      <section className="legal-section">
        <h2>Contact</h2>
        <p>
          For questions about these terms or about a linked document, use the{" "}
          <a href={LINKS.feedback} target="_blank" rel="noopener noreferrer">
            feedback channel
          </a>
          . See also our{" "}
          <Link to="/privacy-policy">Privacy Policy</Link>.
        </p>
      </section>

      <aside className="legal-review" role="note">
        <h2>
          <TriangleAlert size={18} aria-hidden="true" />
          For the site owner to confirm before publication
        </h2>
        <ul className="legal-list">
          <li>
            State the operator or individual responsible for the website, and a
            dedicated contact email. No legal entity or email is invented here.
          </li>
          <li>
            Specify the governing law and jurisdiction. This page deliberately
            omits them because the operating jurisdiction is not known.
          </li>
          <li>
            Confirm that linking to, and previewing, the third-party documents
            is permitted, and add any required attribution.
          </li>
          <li>
            Have these terms reviewed by a qualified professional before they
            are relied upon.
          </li>
        </ul>
      </aside>
    </LegalPage>
  );
}
