import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { API_CONFIG } from "../../config";
import { filterTagsByQuery } from "../utils/tagSearch";

/**
 * TagFilter — searchable admin ticket filter by popular company tags.
 * Matching is debounced and typo tolerant so tags remain easy to find at scale.
 */
export default function TagFilter({ companyId, onFilterChange }) {
  const [popularTags, setPopularTags] = useState([]);
  const [selected, setSelected] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const BACKEND = API_CONFIG.BACKEND_URL;

  useEffect(() => {
    setPopularTags([]);
    if (!companyId) {
      setPopularTags([]);
      return undefined;
    }

    let isCurrent = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token || "";
        const res = await fetch(
          `${BACKEND}/api/tags/popular/${encodeURIComponent(companyId)}?limit=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!res.ok) throw new Error(`Tag lookup failed (${res.status})`);

        const result = await res.json();
        if (isCurrent) {
          setPopularTags(result.success && Array.isArray(result.popular_tags) ? result.popular_tags : []);
        }
      } catch (error) {
        if (isCurrent) {
          console.error("[TagFilter] fetch popular tags:", error);
          setPopularTags([]);
        }
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [BACKEND, companyId]);

  useEffect(() => {
    setSelected([]);
    onFilterChange?.([]);
    setSearchQuery("");
    setDebouncedQuery("");
    setIsDropdownOpen(false);
    setActiveIndex(-1);
  }, [companyId, onFilterChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setActiveIndex(-1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const suggestions = useMemo(
    () => filterTagsByQuery(popularTags, debouncedQuery, 8),
    [popularTags, debouncedQuery]
  );

  function toggle(tag) {
    const updated = selected.includes(tag)
      ? selected.filter((value) => value !== tag)
      : [...selected, tag];

    setSelected(updated);
    onFilterChange?.(updated);
  }

  function selectSuggestion(tag) {
    toggle(tag);
    setSearchQuery("");
    setDebouncedQuery("");
    setIsDropdownOpen(false);
    setActiveIndex(-1);
  }

  function clearAll() {
    setSelected([]);
    onFilterChange?.([]);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      setIsDropdownOpen(false);
      return;
    }

    if (!isDropdownOpen || searchQuery !== debouncedQuery || !debouncedQuery.trim() || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index < 0 ? 0 : (index + 1) % suggestions.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index < 0 ? suggestions.length - 1 : (index - 1 + suggestions.length) % suggestions.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[activeIndex] || suggestions[0];
      if (suggestion?.tag) selectSuggestion(suggestion.tag);
    }
  }

  if (popularTags.length === 0) return null;

  const isSearching = searchQuery.trim().length > 0;
  const isDebouncing = searchQuery !== debouncedQuery;
  const selectedTags = selected.map((tag) => popularTags.find((item) => item.tag === tag) || { tag });
  const popularSuggestions = filterTagsByQuery(popularTags, "", 10);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <label htmlFor="ticket-tag-search" className="text-sm font-semibold text-gray-700">
          🏷️ Filter by Tag
        </label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-indigo-500 hover:underline"
          >
            Clear all ({selected.length})
          </button>
        )}
      </div>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Selected tag filters">
          {selectedTags.map(({ tag }) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white border border-indigo-600"
              aria-label={`Remove tag filter ${tag}`}
            >
              #{tag}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id="ticket-tag-search"
          type="search"
          role="combobox"
          aria-label="Search ticket tags"
          aria-autocomplete="list"
          aria-expanded={isDropdownOpen && isSearching}
          aria-controls="ticket-tag-suggestions"
          aria-activedescendant={
            isDropdownOpen && suggestions[activeIndex]
              ? `ticket-tag-option-${activeIndex}`
              : undefined
          }
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setIsDropdownOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsDropdownOpen(true)}
          onBlur={() => window.setTimeout(() => setIsDropdownOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder="Find a tag (typos are okay)..."
          className="w-full pl-9 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400"
        />
        {searchQuery && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setSearchQuery("");
              setDebouncedQuery("");
              setActiveIndex(-1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear tag search"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}

        {isDropdownOpen && isSearching && (
          <div
            id="ticket-tag-suggestions"
            role="listbox"
            aria-label="Matching ticket tags"
            className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          >
            {isDebouncing ? (
              <p className="px-3 py-2 text-xs text-gray-500">Searching tags…</p>
            ) : suggestions.length > 0 ? (
              suggestions.map(({ tag, count }, index) => (
                <button
                  id={`ticket-tag-option-${index}`}
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(tag)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(tag)}
                  className={`w-full flex items-center justify-between text-left px-3 py-2 text-sm transition-colors ${
                    activeIndex === index ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-slate-50"
                  }`}
                >
                  <span>#{tag}</span>
                  <span className="text-xs text-gray-400">{count ?? 0} tickets</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-gray-500">
                No matching tags. Try another spelling.
              </p>
            )}
          </div>
        )}
      </div>

      {!isSearching && (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Popular tags
          </p>
          <div className="flex flex-wrap gap-2">
            {popularSuggestions.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                  selected.includes(tag)
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-gray-50 text-gray-600 dark:text-gray-400 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                }`}
                aria-pressed={selected.includes(tag)}
              >
                #{tag}
                <span className="opacity-60">({count ?? 0})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
