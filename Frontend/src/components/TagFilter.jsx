import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { API_CONFIG } from "../../config";
import { matchTagSuggestions } from "../utils/matchTagSuggestions";

/**
 * TagFilter — admin ticket list filter by tag
 * Issue #404 — Smart Ticket Tagging System
 */
export default function TagFilter({ companyId, onFilterChange }) {
  const [popularTags, setPopularTags] = useState([]);
  const [selected, setSelected]       = useState([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const BACKEND = API_CONFIG.BACKEND_URL;

  useEffect(() => {
    const id = ++requestId.current;
    if (!companyId) {
      setPopularTags([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setPopularTags([]);
    setLoading(true);
    setError("");
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token || "";
        const res = await fetch(`${BACKEND}/api/tags/popular/${companyId}?limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Could not load ticket tags.");
        const result = await res.json();
        if (id !== requestId.current) return;
        if (!result.success) throw new Error("Could not load ticket tags.");
        setPopularTags(Array.isArray(result.popular_tags) ? result.popular_tags : []);
      } catch (e) {
        if (e.name !== "AbortError" && id === requestId.current) {
          setError("Tag suggestions are unavailable. Try again later.");
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [companyId, BACKEND]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const suggestions = useMemo(
    () => matchTagSuggestions(popularTags, debouncedQuery),
    [popularTags, debouncedQuery],
  );

  function toggle(tag) {
    const updated = selected.includes(tag)
      ? selected.filter((t) => t !== tag)
      : [...selected, tag];
    setSelected(updated);
    onFilterChange?.(updated);
  }

  function clearAll() {
    setSelected([]);
    onFilterChange?.([]);
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && suggestions[activeIndex]) {
      event.preventDefault();
      toggle(suggestions[activeIndex].tag);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">🏷️ Filter by Tag</span>
        {selected.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-indigo-500 hover:underline"
          >
            Clear all ({selected.length})
          </button>
        )}
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-label="Search ticket tags"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls="ticket-tag-suggestions"
        aria-activedescendant={suggestions[activeIndex] ? `ticket-tag-option-${activeIndex}` : undefined}
        placeholder="Search tags…"
        className="w-full mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {loading && <p role="status" className="text-xs text-gray-500">Loading tags…</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {!loading && !error && debouncedQuery && suggestions.length === 0 && (
        <p role="status" className="text-xs text-gray-500">No matching tags.</p>
      )}
      {!loading && !error && popularTags.length === 0 && !debouncedQuery && (
        <p role="status" className="text-xs text-gray-500">No tags available.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {suggestions.map(({ tag, count }, index) => (
          <button
            key={tag}
            id={`ticket-tag-option-${index}`}
            onClick={() => toggle(tag)}
            role="option"
            aria-selected={selected.includes(tag)}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
              text-xs font-medium border transition-colors ${
              selected.includes(tag)
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-gray-50 text-gray-600 dark:text-gray-400 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
            }`}
            aria-pressed={selected.includes(tag)}
          >
            #{tag}
            <span className="opacity-60">({count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
