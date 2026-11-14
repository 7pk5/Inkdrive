// Turns your own screenshots into the exact size the Chrome Web Store wants (1280x800, PNG, no transparency).
//   node scripts/fit-screenshots.mjs <folder with your screenshots> [output folder]
// Each image is scaled to fit and centred on a plain background, so nothing is cropped or stretched.
import sharp from "sharp";
import { mkdirSync, readdirSync } from "node:fs";
import { join, parse } from "node:path";

const [inDir, outDir = "store/screenshots"] = process.argv.slice(2);
if (!inDir) {
  console.error("Usage: node scripts/fit-screenshots.mjs <folder with screenshots> [output folder]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const files = readdirSync(inDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
if (!files.length) {
  console.error(`No images found in ${inDir}`);
  process.exit(1);
}
let n = 0;
for (const f of files.slice(0, 5)) {
  const out = join(outDir, `screenshot-${++n}-${parse(f).name.replace(/\W+/g, "-")}.png`);
  await sharp(join(inDir, f))
    .resize(1280, 800, { fit: "contain", background: "#faf9f5" })
    .flatten({ background: "#faf9f5" })
    .png()
    .toFile(out);
  console.log("wrote", out);
}
if (files.length > 5) console.log(`Only the first 5 were used (the store allows 5). Skipped ${files.length - 5}.`);
