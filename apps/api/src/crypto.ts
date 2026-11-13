import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for drawings (AES-256-GCM).
 *
 * Blob layout:  0xEC | version(1) | keyId(4) | iv(12) | authTag(16) | ciphertext
 *  - keyId = first 4 bytes of sha256(key): lets old keys keep decrypting after a rotation.
 *  - AAD binds each blob to "<fileId>:<revision>", so a blob copied onto another row fails to open.
 *
 * What this protects: database dumps, backups, and anyone with read access to the DB but not to
 * the server's key. What it does not: the running server holds the key (it must, to show and
 * share drawings), so this is not end-to-end encryption.
 */
const MAGIC = 0xec;
const VERSION = 1;
const HEADER = 2 + 4 + 12 + 16;

export class DataCrypto {
  private byKid = new Map<string, Buffer>();
  private current: { kid: Buffer; key: Buffer };

  /** First key seals new data; all keys can open. Each key is base64 of exactly 32 bytes. */
  constructor(keysB64: string[]) {
    if (keysB64.length === 0) throw new Error("DataCrypto needs at least one key");
    const keys = keysB64.map((k) => {
      const key = Buffer.from(k, "base64");
      if (key.length !== 32) throw new Error("Each data key must be 32 bytes (base64). Generate one with: openssl rand -base64 32");
      return key;
    });
    for (const key of keys) this.byKid.set(kidOf(key).toString("hex"), key);
    this.current = { key: keys[0]!, kid: kidOf(keys[0]!) };
  }

  seal(plain: Buffer, aad: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.current.key, iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([Buffer.from([MAGIC, VERSION]), this.current.kid, iv, c.getAuthTag(), ct]);
  }

  /** Opens a sealed blob. Blobs written before encryption existed (plain gzip) pass through. */
  open(blob: Uint8Array, aad: string): Buffer {
    const b = Buffer.from(blob);
    if (b[0] !== MAGIC) return b;
    if (b.length < HEADER || b[1] !== VERSION) throw new Error("Unsupported encrypted blob");
    const key = this.byKid.get(b.subarray(2, 6).toString("hex"));
    if (!key) throw new Error("No key available for this blob (was DATA_KEY rotated without keeping the old one?)");
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(6, 18));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b.subarray(18, 34));
    return Buffer.concat([d.update(b.subarray(34)), d.final()]);
  }
}

const kidOf = (key: Buffer) => createHash("sha256").update(key).digest().subarray(0, 4);

export const generateDataKey = () => randomBytes(32).toString("base64");
