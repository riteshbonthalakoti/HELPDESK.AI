import { describe, expect, it } from "vitest";
import {
  filterTagsByQuery,
  normalizeTagQuery,
  scoreTagMatch,
} from "./tagSearch";

describe("normalizeTagQuery", () => {
  it("normalizes spaces, underscores, hashes, and case", () => {
    expect(normalizeTagQuery("  #VPN Issue__ ")).toBe("vpn-issue");
  });
});

describe("scoreTagMatch", () => {
  it("ranks exact and prefix matches above weaker matches", () => {
    expect(scoreTagMatch("vpn", "vpn")).toBeGreaterThan(scoreTagMatch("vpn-access", "vpn"));
    expect(scoreTagMatch("vpn-access", "vpn")).toBeGreaterThan(scoreTagMatch("remote-vpn-access", "vpn"));
  });

  it("matches adjacent transposition typos", () => {
    expect(scoreTagMatch("network", "netwrok")).toBeGreaterThanOrEqual(0);
  });

  it("matches initials as a fuzzy subsequence", () => {
    expect(scoreTagMatch("virtual-private-network", "vpn")).toBeGreaterThanOrEqual(0);
  });

  it("rejects unrelated queries and avoids fuzzy matching very short input", () => {
    expect(scoreTagMatch("printer-issue", "completely-unrelated")).toBeLessThan(0);
    expect(scoreTagMatch("access", "ax")).toBeLessThan(0);
  });
});

describe("filterTagsByQuery", () => {
  const tags = [
    { tag: "printer-issue", count: 2 },
    { tag: "network", count: 9 },
    { tag: "network-outage", count: 4 },
    { tag: "vpn-access", count: 7 },
  ];

  it("returns typo-tolerant results in relevance order", () => {
    const result = filterTagsByQuery(tags, "netwrok");
    expect(result.map((item) => item.tag)).toEqual(["network"]);
  });

  it("normalizes spaces in queries and matches tag hyphens", () => {
    const result = filterTagsByQuery(tags, "vpn access");
    expect(result[0].tag).toBe("vpn-access");
  });

  it("uses popularity for unfiltered suggestions and respects the result limit", () => {
    const result = filterTagsByQuery(tags, "", 2);
    expect(result.map((item) => item.tag)).toEqual(["network", "vpn-access"]);
  });

  it("supports string entries and removes duplicate tags", () => {
    expect(filterTagsByQuery(["vpn", "VPN", "network"], "vpn")).toEqual(["vpn"]);
  });

  it("returns an empty result for invalid collections", () => {
    expect(filterTagsByQuery(null, "vpn")).toEqual([]);
  });
});
