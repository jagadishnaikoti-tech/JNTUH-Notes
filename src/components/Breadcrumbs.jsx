import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { getResourceByFolderId, getYear } from "../data/site.js";

/**
 * Route-aware breadcrumb trail. Derived from the current URL + the resource
 * metadata (rather than useParams, which is not available to layout-level
 * components) so every page shares one consistent way back up the hierarchy.
 */
function useCrumbs() {
  const { pathname } = useLocation();
  const crumbs = [{ label: "Home", to: "/" }];

  if (pathname === "/") return crumbs;
  if (pathname === "/years") {
    return [...crumbs, { label: "Select Year", current: true }];
  }
  if (pathname === "/code") {
    return [...crumbs, { label: "Learn Code", current: true }];
  }
  if (pathname === "/search") {
    return [...crumbs, { label: "Search", current: true }];
  }

  const yearMatch = /^\/year\/([^/]+)\/?$/.exec(pathname);
  if (yearMatch) {
    const year = getYear(yearMatch[1]);
    return [...crumbs, { label: year ? year.name : "Year", current: true }];
  }

  const subjectMatch = /^\/subject\/([^/]+)\/([^/]+)/.exec(pathname);
  if (subjectMatch) {
    const [, groupId, folderId] = subjectMatch;
    const resource = getResourceByFolderId(folderId);
    const ym = /^year(\d)$/.exec(groupId);
    if (ym) {
      const year = getYear(ym[1]);
      if (year) crumbs.push({ label: year.name, to: `/year/${year.id}` });
    } else if (groupId === "learncode") {
      crumbs.push({ label: "Learn Code", to: "/code" });
    }
    crumbs.push({
      label: resource ? resource.label : "Subject",
      current: true,
    });
    return crumbs;
  }

  return [...crumbs, { label: "Not found", current: true }];
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
            {crumb.current || !crumb.to ? (
              <span className="crumb is-current" aria-current="page">
                {content}
              </span>
            ) : (
              <Link className="crumb" to={crumb.to}>
                {content}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
