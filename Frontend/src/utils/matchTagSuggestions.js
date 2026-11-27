/** Match tags by prefix, substring, then ordered fuzzy subsequence. */
export function matchTagSuggestions(tags, query) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return tags;

  const subsequenceScore = (value) => {
    let index = 0;
    for (const char of value) {
      if (char === needle[index]) index += 1;
      if (index === needle.length) return value.length - needle.length;
    }
    return Number.POSITIVE_INFINITY;
  };

  return tags
    .map((item) => {
      const value = String(item.tag || "").toLocaleLowerCase();
      const score = value.startsWith(needle) ? -2 : value.includes(needle) ? -1 : subsequenceScore(value);
      return { item, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);
}
