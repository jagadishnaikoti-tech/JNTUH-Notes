import { useEffect, useRef } from "react";
import { Download, ExternalLink, X } from "lucide-react";

/**
 * In-app PDF/document preview. Individual files live on Google Drive, which
 * offers a dedicated embed endpoint (/file/d/<id>/preview). The original site
 * did not embed documents, so this viewer is an additive convenience — the
 * original Drive "Open"/"Download" links remain available at all times.
 */
export default function PdfViewer({ file, onClose }) {
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!file) return undefined;

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
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
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
  }, [file]);

  if (!file) return null;
  const embedUrl = `https://drive.google.com/file/d/${file.fileId}/preview`;

  return (
    <div
      className="viewer-wrap"
      data-doc-id={file.fileId}
      data-doc-title={file.title}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${file.title}`}
        tabIndex={-1}
      >
        <div className="viewer-head">
          <span className="viewer-title" title={file.title}>
            {file.title}
          </span>
          <div className="viewer-tools">
            <a
              href={file.url}
              data-doc-action="open"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open in Drive
            </a>
            <a
              href={file.downloadUrl}
              data-doc-action="download"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
            >
              <Download size={15} aria-hidden="true" />
              Download
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onClose}
              ref={closeRef}
              aria-label="Close preview"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="viewer-body">
          <iframe
            src={embedUrl}
            title={`Preview of ${file.title}`}
            allow="autoplay"
            loading="lazy"
          />
          <noscript>
            <p className="viewer-fallback">
              Preview requires JavaScript.{" "}
              <a href={file.url} target="_blank" rel="noopener noreferrer">
                Open in Google Drive
              </a>
              .
            </p>
          </noscript>
        </div>
      </div>
    </div>
  );
}
