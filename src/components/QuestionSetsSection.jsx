import { ListChecks, Target } from "lucide-react";
import { Link } from "react-router-dom";
import {
  QUESTION_CATEGORIES,
  countQuestionSets,
} from "../data/questions.js";
import QuestionCategoryCard from "./QuestionCategoryCard.jsx";

const CARD_ICONS = {
  guaranteed: Target,
  short: ListChecks,
};

/**
 * Homepage section —— "Guaranteed Questions & Short Questions".
 * Links to the real question-set listing routes (/questions/...), which are
 * built from the existing resource inventory (no invented content).
 */
export default function QuestionSetsSection() {
  const guaranteed = QUESTION_CATEGORIES[0];
  const short = QUESTION_CATEGORIES[1];

  return (
    <section className="section question-section" aria-labelledby="qs-title">
      <div className="section-head question-head">
        <div>
          <h2 className="section-title" id="qs-title" style={{ fontSize: "var(--text-3xl)" }}>
            Guaranteed Questions &amp; Short Questions
          </h2>
          <p className="section-sub question-sub" style={{ marginTop: 4 }}>
            Focus your preparation with organized question sets and quick
            revision materials for your semester exams.
          </p>
        </div>
        <span className="qs-badge" role="text">
          Exam Preparation
        </span>
      </div>

      <div className="question-grid">
        <QuestionCategoryCard
          category={guaranteed}
          count={countQuestionSets(guaranteed.id)}
          icon={CARD_ICONS[guaranteed.id]}
        />
        <QuestionCategoryCard
          category={short}
          count={countQuestionSets(short.id)}
          icon={CARD_ICONS[short.id]}
        />
      </div>

      <p className="question-footnote">
        Question sets are pulled from the real study material in your subjects
        — no placeholder links.{" "}
        <Link to="/questions/guaranteed">Browse Guaranteed Questions</Link> ·{" "}
        <Link to="/questions/short">Browse Short Questions</Link>
      </p>
    </section>
  );
}