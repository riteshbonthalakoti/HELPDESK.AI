import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { API_CONFIG } from "../../config";
import TagChip from "./TagChip";
import { filterTagsByQuery, normalizeTagQuery } from "../utils/tagSearch";

/**
 * TicketTagManager — full tag UI for ticket detail view
 * Issue #404 — Smart Ticket Tagging System
 * Features: AI suggestions, accept/dismiss, custom input, autocomplete, save
 */
export default function TicketTagManager({
  ticketId,
  ticketTitle = "",
  ticketBody = "",
  category = "",
  companyId = "",
  readOnly = false,
}) {
  const [suggestedTags, setSuggestedTags]   = useState([]);
  const [acceptedTags, setAcceptedTags]     = useState([]);
  const [popularTags, setPopularTags]       = useState([]);
  const [inputValue, setInputValue]         = useState("");
  const [debouncedInputValue, setDebouncedInputValue] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [showDropdown, setShowDropdown]     = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [saveStatus, setSaveStatus]         = useState(null); // null | "saved" | "error"

  const BACKEND = API_CONFIG.BACKEND_URL;

  // ── Auth token ──────────────────────────────────────────────────────────────
  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || "";
  }, []);

  // ── Load existing tags on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!ticketId) return;
    let isCurrent = true;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${BACKEND}/api/tags/${ticketId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (isCurrent && data.success) setAcceptedTags(data.tags || []);
      } catch (e) {
        console.error("[TagManager] load tags:", e);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [BACKEND, getToken, ticketId]);

  // ── Fetch AI suggestions on mount ──────────────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!ticketTitle && !ticketBody) return;
    (async () => {
      setLoadingSuggest(true);
      try {
        const token = await getToken();
        const res = await fetch(`${BACKEND}/api/tags/suggest`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ticket_title: ticketTitle,
            ticket_body: ticketBody,
            category,
          }),
        });
        const data = await res.json();
        if (data.success && mountedRef.current) {
          setSuggestedTags(data.suggested_tags || []);
        }
      } catch (e) {
        console.error("[TagManager] suggest tags:", e);
      }
      if (mountedRef.current) setLoadingSuggest(false);
    })();
  }, [ticketTitle, ticketBody, category, getToken, BACKEND]);

  // ── Load popular tags for autocomplete when companyId provided ─────────────
  useEffect(() => {
    setPopularTags([]);
    if (!companyId) return undefined;
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
      } catch (e) {
        if (isCurrent) console.error("[TagManager] fetch popular tags:", e);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [BACKEND, companyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedInputValue(inputValue);
      setActiveSuggestionIndex(-1);
    }, 200);

    return () => window.clearTimeout(timer);
  }, [inputValue]);

  const autocompleteOptions = useMemo(() => {
    const availableTags = popularTags.filter((item) => !acceptedTags.includes(item?.tag));
    return filterTagsByQuery(availableTags, debouncedInputValue, 5)
      .map((item) => item.tag);
  }, [acceptedTags, debouncedInputValue, popularTags]);

  // ── Accept / Dismiss suggestions ───────────────────────────────────────────
  function acceptTag(tag) {
    if (!acceptedTags.includes(tag)) setAcceptedTags((p) => [...p, tag]);
    setSuggestedTags((p) => p.filter((t) => t !== tag));
  }

  function dismissTag(tag) {
    setSuggestedTags((p) => p.filter((t) => t !== tag));
  }

  function removeAccepted(tag) {
    setAcceptedTags((p) => p.filter((t) => t !== tag));
  }

  function selectAutocompleteTag(tag) {
    if (!acceptedTags.includes(tag)) setAcceptedTags((p) => [...p, tag]);
    setInputValue("");
    setDebouncedInputValue("");
    setActiveSuggestionIndex(-1);
    setShowDropdown(false);
  }

  // ── Custom tag input ────────────────────────────────────────────────────────
  function handleKeyDown(event) {
    if (event.key === "ArrowDown" && inputValue === debouncedInputValue && autocompleteOptions.length > 0) {
      event.preventDefault();
      setShowDropdown(true);
      setActiveSuggestionIndex((index) => (index < 0 ? 0 : (index + 1) % autocompleteOptions.length));
      return;
    }

    if (event.key === "ArrowUp" && inputValue === debouncedInputValue && autocompleteOptions.length > 0) {
      event.preventDefault();
      setShowDropdown(true);
      setActiveSuggestionIndex((index) => (index < 0 ? autocompleteOptions.length - 1 : (index - 1 + autocompleteOptions.length) % autocompleteOptions.length));
      return;
    }

    if (event.key === "Enter" && inputValue.trim()) {
      event.preventDefault();
      if (showDropdown && autocompleteOptions.length > 0 && inputValue === debouncedInputValue) {
        selectAutocompleteTag(autocompleteOptions[activeSuggestionIndex] || autocompleteOptions[0]);
        return;
      }

      const tag = normalizeTagQuery(inputValue).replace(/[^a-z0-9-]/g, "");
      if (tag && !acceptedTags.includes(tag)) setAcceptedTags((p) => [...p, tag]);
      setInputValue("");
      setDebouncedInputValue("");
      setShowDropdown(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (event.key === "Escape") {
      setShowDropdown(false);
      setInputValue("");
      setDebouncedInputValue("");
      setActiveSuggestionIndex(-1);
    }
  }

  // ── Save tags ───────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!ticketId) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND}/api/tags/${ticketId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tags: acceptedTags }),
      });
      const data = await res.json();
      setSaveStatus(data.success ? "saved" : "error");
      if (data.success) setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      console.error("[TagManager] save tags:", e);
      setSaveStatus("error");
    }
    setSaving(false);
  }

  // ── Read-only mode (for ticket cards) ──────────────────────────────────────
  if (readOnly) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {acceptedTags.length > 0
          ? acceptedTags.map((tag) => <TagChip key={tag} tag={tag} variant="admin" />)
          : <span className="text-xs text-gray-400 italic">No tags</span>}
      </div>
    );
  }

  const isSearching = inputValue.trim().length > 0;
  const isDebouncing = inputValue !== debouncedInputValue;

  return (
    <div className="space-y-4">

      {/* ── AI Suggested Tags ───────────────────────────────────────────────── */}
      {(loadingSuggest || suggestedTags.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
            🤖 AI Suggested Tags
            {loadingSuggest && (
              <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin inline-block" />
            )}
          </p>
          {suggestedTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                    text-xs font-medium border bg-white text-amber-700 border-amber-300"
                >
                  #{tag}
                  <button
                    onClick={() => acceptTag(tag)}
                    className="text-green-600 hover:text-green-800 font-bold ml-0.5"
                    title="Accept"
                    aria-label={`Accept tag ${tag}`}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => dismissTag(tag)}
                    className="text-red-400 hover:text-red-600"
                    title="Dismiss"
                    aria-label={`Dismiss tag ${tag}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {loadingSuggest && suggestedTags.length === 0 && (
            <p className="text-xs text-amber-600">Generating suggestions...</p>
          )}
        </div>
      )}

      {/* ── Accepted Tags ───────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">✅ Applied Tags</p>
        <div className="flex flex-wrap gap-2 min-h-[28px]">
          {acceptedTags.length > 0
            ? acceptedTags.map((tag) => (
                <TagChip key={tag} tag={tag} variant="accepted" onRemove={removeAccepted} />
              ))
            : <span className="text-xs text-gray-400 italic">No tags yet</span>
          }
        </div>
      </div>

      {/* ── Custom Input with Fuzzy Autocomplete ───────────────────────────── */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            setShowDropdown(true);
            setActiveSuggestionIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setShowDropdown(false), 150)}
          onFocus={() => { if (inputValue) setShowDropdown(true); }}
          placeholder="Type a tag — similar tags will appear..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
            focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          aria-label="Add custom tag"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown && isSearching}
          aria-controls="ticket-tag-autocomplete"
          aria-activedescendant={
            showDropdown && autocompleteOptions[activeSuggestionIndex]
              ? `ticket-tag-autocomplete-${activeSuggestionIndex}`
              : undefined
          }
        />
        {showDropdown && isSearching && (
          <div
            id="ticket-tag-autocomplete"
            role="listbox"
            aria-label="Tag suggestions"
            className="absolute z-20 top-full left-0 right-0 mt-1 bg-white
              border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          >
            {isDebouncing ? (
              <p className="px-3 py-2 text-xs text-gray-500">Searching tags…</p>
            ) : autocompleteOptions.length > 0 ? (
              autocompleteOptions.map((tag, index) => (
                <button
                  id={`ticket-tag-autocomplete-${index}`}
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={activeSuggestionIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectAutocompleteTag(tag)}
                  className={`w-full text-left px-3 py-2 text-sm text-gray-700
                    transition-colors ${activeSuggestionIndex === index ? "bg-indigo-50 text-indigo-700" : "hover:bg-indigo-50"}`}
                >
                  #{tag}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-gray-500">
                No saved tag matches. Press Enter to add “{inputValue.trim()}”.
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Suggestions support partial matches and common typos. Press Enter to select the highlighted suggestion or add a new tag.
        </p>
      </div>

      {/* ── Save Button ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
          text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
      >
        {saving
          ? "Saving..."
          : saveStatus === "saved"
          ? "✅ Tags Saved!"
          : saveStatus === "error"
          ? "❌ Save Failed — Try Again"
          : "Save Tags"}
      </button>
    </div>
  );
}
