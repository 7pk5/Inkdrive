import { describe, expect, it } from "vitest";
import { CreateTagBody, MAX_TAGS_PER_ITEM, PatchFileBody, Scene, SetTagsBody, UpdateTagBody, compareVersions } from "../src/index";

describe("Scene (the only thing we check about a drawing)", () => {
  it("accepts an Excalidraw document, keeping unknown fields", () => {
    const r = Scene.safeParse({ type: "excalidraw", version: 2, elements: [{ any: "thing" }], appState: {}, files: {}, extra: 1 });
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).extra).toBe(1);
  });
  it("rejects other JSON", () => {
    for (const bad of [{}, { type: "excalidraw" }, { type: "excalidraw/clipboard", elements: [] }, { type: "excalidraw", elements: "no" }, null, 5]) {
      expect(Scene.safeParse(bad).success).toBe(false);
    }
  });
});

describe("compareVersions", () => {
  it("orders versions numerically, not alphabetically", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("request schemas", () => {
  it("trims tag names and refuses empty or oversized ones and unknown colours", () => {
    expect(CreateTagBody.parse({ name: "  Work  " }).name).toBe("Work");
    expect(CreateTagBody.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateTagBody.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(CreateTagBody.safeParse({ name: "ok", color: "pink" }).success).toBe(false);
    expect(UpdateTagBody.safeParse({}).success).toBe(false);
  });
  it("caps how many tags one item can carry", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(SetTagsBody.safeParse({ tagIds: Array(MAX_TAGS_PER_ITEM).fill(id) }).success).toBe(true);
    expect(SetTagsBody.safeParse({ tagIds: Array(MAX_TAGS_PER_ITEM + 1).fill(id) }).success).toBe(false);
    expect(SetTagsBody.safeParse({ tagIds: ["nope"] }).success).toBe(false);
  });
  it("refuses an empty file patch", () => {
    expect(PatchFileBody.safeParse({}).success).toBe(false);
    expect(PatchFileBody.safeParse({ starred: true }).success).toBe(true);
  });
});
