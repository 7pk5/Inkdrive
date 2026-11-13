import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
// @ts-expect-error plain .mjs helper shared with the build scripts
import { extensionIdFromPublicKey } from "../scripts/extension-id.mjs";

const newKey = () => generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");

describe("extensionIdFromPublicKey", () => {
  it("makes a 32-letter id from a to p, the shape Chrome uses", () => {
    expect(extensionIdFromPublicKey(newKey())).toMatch(/^[a-p]{32}$/);
  });
  it("is deterministic, and different keys give different ids", () => {
    const a = newKey();
    expect(extensionIdFromPublicKey(a)).toBe(extensionIdFromPublicKey(a));
    expect(extensionIdFromPublicKey(a)).not.toBe(extensionIdFromPublicKey(newKey()));
  });
  it("rejects something that is not a key", () => {
    expect(() => extensionIdFromPublicKey("c2hvcnQ=")).toThrow();
  });
});
