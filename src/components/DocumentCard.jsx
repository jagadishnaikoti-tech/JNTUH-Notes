import { Download, ExternalLink, Eye, FileText } from "lucide-react";
import { extLabel } from "../data/site.js";

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function DocumentCard({ file, onPreview, showSubject = false }) {
  const canPreview = typeof onPreview === "function";

  return (
    <article className="doc-card">
      <div className="doc-card-head">
        <span className="doc-icon" aria-hidden="true">
          <FileText size={18} />
        </span>
        <span className="doc-badge">{extLabel(file.ext)}</span>
        {showSubject && file.subject ? (
          <span className="doc-badge">{file.subject}</span>
        ) : null}
      </div>

      <h3 className="doc-title">{file.title}</h3>
      <p className="doc-path">
        {file.path}
        {file.bytes ? ` • ${formatBytes(file.bytes)}` : ""}
      </p>

      <div className="doc-actions">
        {canPreview ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onPreview(file)}
          >
            <Eye size={15} aria-hidden="true" />
            Preview
          </button>
        ) : null}
        <a
          className="btn btn-ghost btn-sm"
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={15} aria-hidden="true" />
          Open
        </a>
        <a
          className="btn btn-ghost btn-sm"
          href={file.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download size={15} aria-hidden="true" />
          Download
        </a>
      </div>
    </article>
  );
}
