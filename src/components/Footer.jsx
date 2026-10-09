import { useCopyrightModal } from "./ModalContext.jsx";
import { LINKS } from "../data/site.js";

export default function Footer({ feedback = false }) {
  const openCopyright = useCopyrightModal();

  return (
    <footer className="site-footer">
      {feedback ? (
        <p className="footer-feedback">
          Give us{" "}
          <a
            className="clrn"
            href={LINKS.codeFeedback}
            target="_blank"
            rel="noopener noreferrer"
          >
            FEEDBACK
          </a>
        </p>
      ) : null}

      <p className="footer-attribution">
        Developed by <strong>Jagadish</strong>
      </p>

      <button type="button" className="btn btn-ghost btn-sm" onClick={openCopyright}>
        Credits &amp; copyright
      </button>
    </footer>
  );
}
