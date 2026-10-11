import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, Inbox, TriangleAlert } from "lucide-react";
import { getResourceByFolderId, getYear } from "../data/site.js";
import FileTree from "../components/FileTree.jsx";
import Footer from "../components/Footer.jsx";
import PdfViewer from "../components/PdfViewer.jsx";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function groupContext(groupId) {
  if (/^year\d$/.test(groupId)) {
    const year = getYear(groupId.replace("year", ""));
    return {
      title: year ? year.name : "Subjects",
      back: `/year/${groupId.replace("year", "")}`,
    };
  }
  if (groupId === "learncode") return { title: "Learn Code", back: "/code" };
  if (groupId === "syllabus") return { title: "Select Year", back: "/years" };
  return { title: "Resources", back: "/years" };
}

export default function SubjectPage() {
  const { groupId, folderId } = useParams();
  const [preview, setPreview] = useState(null);

  const resource = getResourceByFolderId(folderId);
  const ctx = groupContext(groupId);

  if (!resource) {
    return (
      <main className="page-main">
        <div className="error-state" role="alert">
          <h1 style={{ marginTop: 0 }}>
            <TriangleAlert
              size={20}
              aria-hidden="true"
              style={{ display: "inline", verticalAlign: "-3px" }}
            />{" "}
            Resource unavailable
          </h1>
          <p>
            This subject folder could not be found in the resource inventory. It
            may be a link that was not published on the original website.
          </p>
          <Link className="btn btn-secondary btn-sm" to={ctx.back}>
            Go back
          </Link>
        </div>
      </main>
    );
  }

  const { stats } = resource;

  return (
    <main className="page-main">
      <div className="subject-banner">
        <p className="eyebrow">{ctx.title}</p>
        <h1>{resource.label}</h1>

        <div className="banner-stats">
          <span className="stat">
            <span className="stat-value">{stats.files}</span>
            <span className="stat-label">Files</span>
          </span>
          <span className="stat">
            <span className="stat-value">{stats.folders}</span>
            <span className="stat-label">Sub-folders</span>
          </span>
          <span className="stat">
            <span className="stat-value">{formatBytes(stats.bytes)}</span>
            <span className="stat-label">Size</span>
          </span>
        </div>

        <p className="meta-line">
          Original folder:{" "}
          <a href={resource.url} target="_blank" rel="noopener noreferrer">
            {resource.url}
          </a>
        </p>

        <div className="hero-actions mt-md">
          <a
            className="btn btn-primary"
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FolderOpen size={17} aria-hidden="true" />
            Open folder on Google Drive
          </a>
          <Link className="btn btn-ghost" to={ctx.back}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </Link>
        </div>
      </div>

      {resource.files.length === 0 ? (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">
            <Inbox size={26} />
          </span>
          <h2 style={{ margin: 0 }}>No documents listed here</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            This folder is empty or its contents are not publicly listable. Use
            “Open folder on Google Drive” above to view it directly.
          </p>
        </div>
      ) : (
        <>
          {/* Keeps the heading hierarchy sequential (h1 -> h2 -> h3 cards). */}
          <h2 className="sr-only">Files in this folder</h2>
          <FileTree
            nodes={resource.files}
            onPreview={setPreview}
            subject={resource.label}
            yearName={/^year\d$/.test(groupId) ? ctx.title : ""}
            yearId={/^year\d$/.test(groupId) ? groupId.replace("year", "") : ""}
          />
        </>
      )}

      {preview ? (
        <PdfViewer file={preview} onClose={() => setPreview(null)} />
      ) : null}

      <Footer />
    </main>
  );
}
