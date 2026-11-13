import { describe, expect, it } from "vitest";
import { hashElements, imageIds, needsRepair, sceneHash } from "../src/hash";

const el = (over: Record<string, unknown> = {}) => ({
  id: "a", type: "rectangle", index: "a0", version: 3, versionNonce: 11, seed: 5, isDeleted: false, ...over,
});

describe("sceneHash (decides whether anything changed since the last save)", () => {
  it("is stable for the same drawing", () => {
    expect(hashElements([el(), el({ id: "b", version: 7 })])).toBe(hashElements([el(), el({ id: "b", version: 7 })]));
  });
  it("changes when an element's version changes, or an element is added", () => {
    const base = hashElements([el()]);
    expect(hashElements([el({ version: 4 })])).not.toBe(base);
    expect(hashElements([el(), el({ id: "b" })])).not.toBe(base);
  });
  it("ignores deleted elements, so deleting-then-cleaning-up does not look like a change", () => {
    expect(hashElements([el(), el({ id: "gone", isDeleted: true })])).toBe(hashElements([el()]));
  });
  it("does not care about extra, non-versioned fields", () => {
    expect(hashElements([el({ strokeColor: "#fff" })])).toBe(hashElements([el({ strokeColor: "#000" })]));
  });
  it("counts the images a drawing uses", () => {
    const withImage = [el({ id: "i", type: "image", fileId: "f1" })];
    expect(sceneHash(withImage, ["f1"])).not.toBe(sceneHash(withImage, []));
  });
  it("copes with an empty or corrupt scene without throwing", () => {
    expect(hashElements([])).toMatch(/-0$/);
    expect(() => hashElements([null, undefined, el()] as unknown[])).not.toThrow();
    expect(hashElements([null, el()] as unknown[])).toBe(hashElements([el()]));
  });
});

describe("imageIds", () => {
  it("lists images that are still on the canvas only", () => {
    const ids = imageIds([
      el({ id: "1", type: "image", fileId: "keep" }),
      el({ id: "2", type: "image", fileId: "deleted", isDeleted: true }),
      el({ id: "3", type: "rectangle", fileId: "not-an-image" }),
      el({ id: "4", type: "image", fileId: null }),
      null,
    ] as unknown[]);
    expect([...ids]).toEqual(["keep"]);
  });
});

describe("needsRepair (files that must go through a page reload)", () => {
  it("accepts what a current Excalidraw writes", () => {
    expect(needsRepair([el(), el({ id: "b" })])).toBe(false);
    expect(needsRepair([])).toBe(false);
  });
  it("flags files from older or other tools that lack modern fields", () => {
    expect(needsRepair([el({ index: undefined })])).toBe(true);
    expect(needsRepair([el({ version: undefined })])).toBe(true);
    expect(needsRepair([el({ versionNonce: "x" })])).toBe(true);
    expect(needsRepair([el({ seed: undefined })])).toBe(true);
    expect(needsRepair([el({ id: 5 })])).toBe(true);
  });
  it("flags null and junk entries instead of crashing", () => {
    expect(needsRepair([null])).toBe(true);
    expect(needsRepair([el(), null])).toBe(true);
  });
});
