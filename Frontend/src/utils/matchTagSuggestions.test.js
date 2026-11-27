import { describe, expect, it } from "vitest";
import { matchTagSuggestions } from "./matchTagSuggestions";

describe("matchTagSuggestions", () => {
  const tags = [{ tag: "billing" }, { tag: "network" }, { tag: "security" }];

  it("returns all tags for an empty query", () => {
    expect(matchTagSuggestions(tags, " ")).toEqual(tags);
  });

  it("ranks prefix and substring matches before fuzzy subsequences", () => {
    expect(matchTagSuggestions(tags, "net").map(({ tag }) => tag)).toEqual(["network"]);
    expect(matchTagSuggestions(tags, "scty").map(({ tag }) => tag)).toEqual(["security"]);
  });

  it("matches without case sensitivity and returns no unrelated tags", () => {
    expect(matchTagSuggestions(tags, "BILL").map(({ tag }) => tag)).toEqual(["billing"]);
    expect(matchTagSuggestions(tags, "nothing")).toEqual([]);
  });
});
