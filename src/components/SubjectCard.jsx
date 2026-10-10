import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { getResourceByFolderId } from "../data/site.js";

export default function SubjectCard({ subject, yearId }) {
  const resource = getResourceByFolderId(subject.folderId);
  const count = resource ? resource.stats.files : 0;

  if (subject.disabled || !subject.folderId) {
    return (
      <div
        className="subject-card is-disabled"
        aria-disabled="true"
        title="This subject has no link on the original website."
      >
        <span className="subject-card-icon" aria-hidden="true">
          <BookOpen size={18} />
        </span>
        <span className="subject-card-body">
          <span className="subject-name">{subject.label}</span>
          <span className="subject-count">No link available</span>
        </span>
      </div>
    );
  }

  return (
    <Link
      className="subject-card"
      to={`/subject/year${yearId}/${subject.folderId}`}
      aria-label={`${subject.label}: ${count} ${count === 1 ? "item" : "items"}`}
    >
      <span className="subject-card-icon" aria-hidden="true">
        <BookOpen size={18} />
      </span>
      <span className="subject-card-body">
        <span className="subject-name">{subject.label}</span>
        <span className="subject-count">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </span>
    </Link>
  );
}
