import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { LINKS } from "../data/site.js";

/**
 * COPYRIGHTS dialog. Content is preserved verbatim from the reference site;
 * only the visual treatment follows the new design system.
 */
export default function CopyrightModal({ onClose }) {
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event) => {
      if (dialog && !dialog.contains(event.target)) closeRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copyright-modal-title"
        tabIndex={-1}
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
