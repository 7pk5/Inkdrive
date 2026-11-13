// Renders brand/logo-icon.svg to the PNG sizes Chrome needs. Run: npm run icons --workspace @ecd/extension
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../../../brand/logo-icon.svg", import.meta.url));
await mkdir(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(new URL(`../icons/${size}.png`, import.meta.url).pathname);
  console.log(`icons/${size}.png`);
}
