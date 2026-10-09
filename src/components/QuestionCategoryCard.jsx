import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

/**
 * One category card for the homepage "Guaranteed Questions & Short Questions"
 * section. The whole card is a styled wrapper; the button is the interactive
 * element (no nested links), so keyboard users and screen readers get one
 * clean, labelled destination per card.
 */
export default function QuestionCategoryCard({ category, count, icon: Icon }) {
  return (
    <article className="question-card">
      <span className="question-card-icon" aria-hidden="true">
        <Icon size={24} />
      </span>

      <h3 className="question-card-title">{category.title}</h3>
      <p className="question-card-desc">{category.description}</p>
      <p className="question-card-meta">
        {count} real question set{count === 1 ? "" : "s"} available
      </p>

      <Link className="btn btn-primary question-card-btn" to={category.to}>
        <span>{category.cta}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}