// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TagFilter from "./TagFilter";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../lib/supabaseClient", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock("../../config", () => ({
  API_CONFIG: { BACKEND_URL: "https://helpdesk.test" },
}));

let container;
let root;
let onFilterChange;

const popularTags = [
  { tag: "network", count: 9 },
  { tag: "vpn-access", count: 7 },
  { tag: "printer-issue", count: 2 },
];

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

async function renderTagFilter() {
  await act(async () => {
    root.render(
      <TagFilter companyId="company-1" onFilterChange={onFilterChange} />
    );
    await flushPromises();
  });
}

async function searchFor(value) {
  const input = container.querySelector('input[aria-label="Search ticket tags"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;

  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    vi.advanceTimersByTime(249);
  });
  expect(container.textContent).toContain("Searching tags…");

  await act(async () => {
    vi.advanceTimersByTime(1);
  });
}

describe("TagFilter fuzzy autocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          popular_tags: popularTags,
        }),
      })
    );

    onFilterChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("debounces the query and finds tags despite an adjacent-character typo", async () => {
    await renderTagFilter();
    await searchFor("netwrok");

    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("#network");

    await act(async () => options[0].click());
    expect(onFilterChange).toHaveBeenLastCalledWith(["network"]);
    expect(container.querySelector('[aria-label="Remove tag filter network"]')).not.toBeNull();
  });

  it("supports selecting a fuzzy match with the keyboard", async () => {
    await renderTagFilter();
    await searchFor("vnp-access");

    const input = container.querySelector('input[aria-label="Search ticket tags"]');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onFilterChange).toHaveBeenLastCalledWith(["vpn-access"]);
  });
});
