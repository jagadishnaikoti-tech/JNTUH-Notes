import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { LINKS } from "../data/site.js";

/**
 * COPYRIGHTS dialog. Content is preserved verbatim from the reference site;
 * only the visual treatment follows the new design system.
 */
export default function CopyrightModal({ onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copyright-modal-title"
      >
        <div className="modal-header">
          <h2 className="modal-title" id="copyright-modal-title">
            COPYRIGHTS ©
          </h2>
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={onClose}
            ref={closeRef}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          Hello...👋
          <br /> This is{" "}
          <a
            href={LINKS.authorProfile}
            className="clrn"
            target="_blank"
            rel="noopener noreferrer"
          >
            JASHVA
          </a>
          <br /> Currently Pursing B.Tech in St.Mary's Engineering College - Hyd.
          <hr />
          Copyright © 2023 VARUN &amp; HARISH - All Rights Reserved
          <hr /> Helped by Nagaraju &amp; Abhilash
          <hr /> Supported by St.Mary's Engineering College - Deshmukhi, Hyd.
          <hr />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
          <a
            className="btn btn-primary btn-sm"
            target="_blank"
            rel="noopener noreferrer"
            href={LINKS.feedback}
          >
            Give us Feedback
          </a>
        </div>
      </div>
    </div>
  );
}
