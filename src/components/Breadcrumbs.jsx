import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { describeRoute } from "../lib/meta.js";
import { buildCrumbs } from "../lib/seo.js";

/**
 * Route-aware breadcrumb trail. Derived from the shared route descriptor so it
 * covers every page (subjects, question sets, legal pages) and matches the
 * BreadcrumbList structured data exactly.
 */
function useCrumbs() {
  const { pathname } = useLocation();
  return buildCrumbs(describeRoute(pathname));
}

export default function Breadcrumbs() {
  const crumbs = useCrumbs();

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isHome = i === 0;
        const content = isHome ? (
          <>
            <Home
              size={14}
              aria-hidden="true"
              style={{ display: "inline", verticalAlign: "-2px" }}
            />
            <span className="sr-only">Home</span>
          </>
        ) : (
          crumb.label
        );

        return (
          <span
            key={`${crumb.label}-${i}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {i > 0 ? (
              <ChevronRight className="crumb-sep" size={14} aria-hidden="true" />
            ) : null}
            {crumb.current || !crumb.path ? (
              <span className="crumb is-current" aria-current="page">
                {content}
              </span>
            ) : (
              <Link className="crumb" to={crumb.path}>
                {content}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
