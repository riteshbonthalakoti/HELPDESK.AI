/**
 * Normalize a tag query so spaces, underscores, and leading hash symbols
 * behave consistently with the hyphenated tags stored by the API.
 */
export function normalizeTagQuery(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function damerauLevenshteinDistance(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let i = 0; i < rows; i += 1) distance[i][0] = i;
  for (let j = 0; j < columns; j += 1) distance[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      distance[i][j] = Math.min(
        distance[i - 1][j] + 1,
        distance[i][j - 1] + 1,
        distance[i - 1][j - 1] + substitutionCost
      );

      // Treat an adjacent character swap as one typo (e.g. "netwrok").
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        distance[i][j] = Math.min(distance[i][j], distance[i - 2][j - 2] + 1);
      }
    }
  }

  return distance[left.length][right.length];
}

function subsequenceScore(candidate, query) {
  let queryIndex = 0;
  let previousMatch = -1;
  let totalGap = 0;

  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue;
    if (previousMatch >= 0) totalGap += index - previousMatch - 1;
    previousMatch = index;
    queryIndex += 1;
  }

  if (queryIndex !== query.length) return -1;
  return 600 - totalGap * 8 - Math.max(0, candidate.length - query.length) * 0.5;
}

/**
 * Return a relevance score for a tag. A negative score means there is no match.
 * Exact and prefix matches rank first, followed by substrings, subsequences,
 * and finally short edit-distance matches for common typing mistakes.
 */
export function scoreTagMatch(tag, query) {
  const candidate = normalizeTagQuery(tag);
  const normalizedQuery = normalizeTagQuery(query);

  if (!candidate || !normalizedQuery) return -1;
  if (candidate === normalizedQuery) return 1000;
  if (candidate.startsWith(normalizedQuery)) return 900 - (candidate.length - normalizedQuery.length);

  const substringIndex = candidate.indexOf(normalizedQuery);
  if (substringIndex >= 0) return 780 - substringIndex * 4;

  const sequenceScore = subsequenceScore(candidate, normalizedQuery);
  if (sequenceScore >= 0) return sequenceScore;

  const maxDistance = normalizedQuery.length >= 8 ? 2 : normalizedQuery.length >= 3 ? 1 : 0;
  if (!maxDistance) return -1;

  const distance = damerauLevenshteinDistance(candidate, normalizedQuery);
  if (distance > maxDistance) return -1;

  return 420 - distance * 80 - Math.abs(candidate.length - normalizedQuery.length) * 4;
}

/**
 * Fuzzy-match popular tag records or strings and return the original entries,
 * ranked by relevance. The count field is used only as a stable tie-breaker.
 */
export function filterTagsByQuery(tags = [], query = "", limit = 8) {
  if (!Array.isArray(tags)) return [];

  const normalizedQuery = normalizeTagQuery(query);
  const uniqueEntries = new Map();

  tags.forEach((entry, index) => {
    const tag = typeof entry === "string" ? entry : entry?.tag;
    const normalizedTag = normalizeTagQuery(tag);
    if (!normalizedTag || uniqueEntries.has(normalizedTag)) return;

    uniqueEntries.set(normalizedTag, {
      entry,
      index,
      score: normalizedQuery ? scoreTagMatch(normalizedTag, normalizedQuery) : 0,
      count: Number(typeof entry === "object" ? entry?.count : 0) || 0,
    });
  });

  const ranked = [...uniqueEntries.values()];
  const matches = normalizedQuery
    ? ranked.filter((item) => item.score >= 0).sort((a, b) =>
        b.score - a.score || b.count - a.count || a.index - b.index
      )
    : ranked.sort((a, b) => b.count - a.count || a.index - b.index);

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8;
  return matches.slice(0, safeLimit).map((item) => item.entry);
}
