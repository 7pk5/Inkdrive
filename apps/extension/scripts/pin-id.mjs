// Pins the extension id.   npm run pin-id --workspace @ecd/extension
// Creates .extension-key.pem (PRIVATE: gitignored, back it up) and .extension-key.pub, then prints the id.
// build.mjs adds the public key to the manifest, so every build of this extension has the same id.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { extensionIdFromPublicKey } from "./extension-id.mjs";

const pem = new URL("../.extension-key.pem", import.meta.url);
const pub = new URL("../.extension-key.pub", import.meta.url);

let created = false;
if (!existsSync(pub)) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(pem, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  chmodSync(pem, 0o600);
  writeFileSync(pub, publicKey.export({ type: "spki", format: "der" }).toString("base64"));
  created = true;
}
const id = extensionIdFromPublicKey(readFileSync(pub, "utf8").trim());
console.log(`${created ? "Created a new key. " : "Using the existing key. "}Extension id:\n\n  ${id}\n`);
console.log(`Google redirect URI:  https://${id}.chromiumapp.org/`);
console.log(`Server CORS origin:   chrome-extension://${id}`);
if (created) console.log("\nBack up apps/extension/.extension-key.pem (a password manager is fine). It is gitignored and never leaves this computer.");
