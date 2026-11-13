import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { DataCrypto, generateDataKey } from "../src/crypto.js";

const plain = Buffer.from("secret drawing contents");

describe("DataCrypto", () => {
  it("round-trips and hides the plaintext", () => {
    const c = new DataCrypto([generateDataKey()]);
    const blob = c.seal(plain, "file:1");
    expect(blob.includes(plain)).toBe(false);
    expect(blob[0]).toBe(0xec);
    expect(c.open(blob, "file:1").equals(plain)).toBe(true);
  });

  it("uses a fresh IV every time", () => {
    const c = new DataCrypto([generateDataKey()]);
    expect(c.seal(plain, "a").equals(c.seal(plain, "a"))).toBe(false);
  });

  it("refuses a blob moved to another file or revision (AAD binding)", () => {
    const c = new DataCrypto([generateDataKey()]);
    const blob = c.seal(plain, "file-a:1");
    expect(() => c.open(blob, "file-b:1")).toThrow();
    expect(() => c.open(blob, "file-a:2")).toThrow();
  });

  it("detects tampering", () => {
    const c = new DataCrypto([generateDataKey()]);
    const blob = c.seal(plain, "x:1");
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
    expect(() => c.open(blob, "x:1")).toThrow();
  });

  it("cannot be opened with a different key", () => {
    const blob = new DataCrypto([generateDataKey()]).seal(plain, "x:1");
    expect(() => new DataCrypto([generateDataKey()]).open(blob, "x:1")).toThrow();
  });

  it("supports key rotation: old blobs open, new blobs use the new key", () => {
    const oldKey = generateDataKey();
    const oldBlob = new DataCrypto([oldKey]).seal(plain, "x:1");
    const rotated = new DataCrypto([generateDataKey(), oldKey]);
    expect(rotated.open(oldBlob, "x:1").equals(plain)).toBe(true);
    const newBlob = rotated.seal(plain, "x:2");
    expect(() => new DataCrypto([oldKey]).open(newBlob, "x:2")).toThrow();
  });

  it("passes pre-encryption (plain gzip) blobs through", () => {
    const gz = gzipSync(plain);
    expect(new DataCrypto([generateDataKey()]).open(gz, "x:1").equals(gz)).toBe(true);
  });

  it("rejects keys of the wrong size", () => {
    expect(() => new DataCrypto(["c2hvcnQ="])).toThrow(/32 bytes/);
  });
});
