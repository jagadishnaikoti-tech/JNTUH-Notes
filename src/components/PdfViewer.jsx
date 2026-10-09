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

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file) return null;
  const embedUrl = `https://drive.google.com/file/d/${file.fileId}/preview`;

  return (
    <div
      className="viewer-wrap"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${file.title}`}
      >
        <div className="viewer-head">
          <span className="viewer-title" title={file.title}>
            {file.title}
          </span>
          <div className="viewer-tools">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open in Drive
            </a>
            <a
              href={file.downloadUrl}
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
