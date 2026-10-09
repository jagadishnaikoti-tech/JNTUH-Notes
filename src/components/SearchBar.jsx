import { useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SITE } from "../data/site.js";

/**
 * Search control used in the header and on the home page. Submitting (via the
 * button or Enter inside the form) navigates to /search?q=<term>, which is a
 * real route that renders results.
 */
export default function SearchBar({
  id = "site-search",
  initialValue = "",
  compact = false,
  autoFocus = false,
  onSubmitted,
}) {
  const [query, setQuery] = useState(initialValue);
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    onSubmitted?.();
  };

  return (
    <form className="searchbar" role="search" onSubmit={submit}>
      <Search size={18} aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>
        Search subjects and documents
      </label>
      <input
        id={id}
        className="searchbar-input"
        type="search"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={SITE.searchPlaceholder}
      />
      <button type="submit" className="searchbar-btn">
        {compact ? "Go" : "Search"}
      </button>
    </form>
  );
}
