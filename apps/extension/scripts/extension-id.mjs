import { createHash } from "node:crypto";

/**
 * A Chrome extension's id is derived from its public key: the first 16 bytes of sha256(DER public key),
 * written in hex with the digits 0-f replaced by the letters a-p. Putting that key in the manifest ("key")
 * pins the id, so the Google redirect URI (https://<id>.chromiumapp.org/) and the server's CORS origin
 * stay valid on every machine and every build. Without it the id depends on the folder you loaded.
 */
export function extensionIdFromPublicKey(derBase64) {
  const der = Buffer.from(derBase64, "base64");
  if (der.length < 64) throw new Error("not a DER public key");
  return [...createHash("sha256").update(der).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join("");
}
