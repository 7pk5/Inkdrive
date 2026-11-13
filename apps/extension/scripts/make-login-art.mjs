// Draws the turboprop-governor diagram as REAL Excalidraw elements and renders the same elements with
// rough.js (the engine Excalidraw uses for its hand-drawn look) and Excalidraw's handwriting font.
//
//   npm run art --workspace @ecd/extension
//
// Outputs (brand/art/):  turboprop.excalidraw  (open or upload it in Excalidraw / Inkdrive)
//                        turboprop.svg, turboprop.png   (also copied to assets/login-art.svg for the sign-in screen)
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import * as fontkit from "fontkit";
import rough from "roughjs";
import sharp from "sharp";

const OUT = new URL("../../../brand/art/", import.meta.url);
await mkdir(OUT, { recursive: true });

const font = fontkit.create(await readFile(new URL("../assets/fonts/hand-latin.woff2", import.meta.url)));
const gen = rough.generator();

// ---------------------------------------------------------------- colours
// Two palettes: what the SVG shows (the dark look of the original) and what the .excalidraw file stores
// (Excalidraw's standard palette: its dark theme inverts these to the same look, its light theme shows them as is).
const SHOW = { line: "#e3e3e3", orange: "#bd6a0c", olive: "#3a3210", card: "#121212", text: "#e3e3e3" };
const SAVE = { line: "#1e1e1e", orange: "#e8590c", olive: "#ffec99", text: "#1e1e1e" };

// ---------------------------------------------------------------- scene model
/** @type {any[]} */
const scene = [];
let seed = 1000;
const nextSeed = () => (seed += 37);
const add = (e) => scene.push({ seed: nextSeed(), ...e });

const mirrorY = (pts, cy) => pts.map(([x, y]) => [x, 2 * cy - y]);
const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);

/** One diagram. Coordinates are those of the reference screenshot; (ox, oy) moves it into the scene. */
function diagram({ ox, oy, blade, hub, hatch, hubTopY, hubBottomY, hubBackX, centerY, shaft, innerShaft, box, small, bar, lever, texts, arrows }) {
  const P = (pts) => shift(pts, ox, oy);
  // propeller blades (upper + mirrored lower)
  add({ kind: "curve", pts: P(blade), closed: true });
  add({ kind: "curve", pts: P(mirrorY(blade, centerY)), closed: true });
  // nose cone + back plate
  add({ kind: "curve", pts: P(hub) });
  add({ kind: "line", pts: P([[hubBackX, hubTopY], [hubBackX, hubBottomY]]) });
  // the spring: slanted coils and the centre line
  for (const [a, b] of hatch.coils) add({ kind: "line", pts: P([a, b]), thin: true });
  add({ kind: "line", pts: P(hatch.axis), thin: true });
  // shaft, governor, oil
  add({ kind: "rect", ...rect(shaft, ox, oy), r: 4 });
  if (innerShaft) add({ kind: "line", pts: P(innerShaft), color: "olive", width: 3 });
  add({ kind: "rect", ...rect(box, ox, oy), r: 24 });
  add({ kind: "rect", ...rect(small, ox, oy), r: 6 });
  add({ kind: "rect", ...rect(bar, ox, oy), r: 3, fill: true });
  // prop lever
  add({ kind: "ellipse", cx: lever.ellipse[0] + ox, cy: lever.ellipse[1] + oy, w: 18, h: 14 });
  add({ kind: "rect", ...rect(lever.rect, ox, oy), r: 3 });
  add({ kind: "line", pts: P(lever.line) });
  // labels and arrows
  for (const t of texts) add({ kind: "text", x: t.x + ox, y: t.y + oy, text: t.text, size: t.size ?? 20, color: t.color ?? "orange" });
  for (const a of arrows) add({ kind: "arrow", pts: P(a), color: "orange", width: 2 });
}
const rect = ([x, y, w, h], ox, oy) => ({ x: x + ox, y: y + oy, w, h });

// ---- diagram 1: spring pushes the blades to feather (reference screenshot coordinates, card top-left = 33,137)
const D1 = { x: 33 - 28, y: 137 - 20 }; // card padding
diagram({
  ox: -D1.x, oy: -D1.y,
  blade: [[300, 146], [286, 160], [276, 200], [277, 245], [285, 278], [296, 292], [335, 292], [337, 255], [334, 215], [325, 178], [313, 153], [300, 146]],
  hub: [[340, 285], [300, 288], [258, 305], [230, 330], [222, 343], [230, 358], [258, 382], [300, 398], [340, 402]],
  hubBackX: 340, hubTopY: 285, hubBottomY: 402, hubTopY2: 0, centerY: 343,
  hatch: { coils: Array.from({ length: 6 }, (_, i) => [[238 + 14 * i, 366], [256 + 14 * i, 320]]), axis: [[232, 343], [335, 343]] },
  shaft: [337, 335, 228, 13], box: [555, 277, 108, 128], small: [563, 313, 31, 62], bar: [593, 335, 227, 13],
  lever: { ellipse: [703, 177], rect: [665, 205, 34, 13], line: [[697, 186], [622, 290]] },
  texts: [
    { x: 768, y: 173, text: "Prop Lever" },
    { x: 433, y: 237, text: "Primary Govenor" },
    { x: 740, y: 274, text: "Engine Oil Pressure" },
    { x: 40, y: 259, text: "Gigantic Spring" },
    { x: 42, y: 286, text: "Always pushes it to\nfeathered", size: 14, color: "text" },
  ],
  arrows: [
    [[762, 187], [745, 184], [724, 183]],
    [[552, 262], [564, 285], [571, 317]],
    [[778, 300], [769, 320], [758, 341]],
    [[192, 272], [225, 276], [244, 300], [257, 326]],
  ],
});

const D1_COUNT = scene.length; // elements 0..D1_COUNT-1 are diagram 1 (used for the narrow banner)

// ---- diagram 2: oil pressure compresses the spring (card top-left = 33,579), stacked below diagram 1
const D2 = { x: 33 - 28, y: 579 - (446 + 24 + 20) }; // same padding, placed 24px under card 1 (card 2 starts at y = 470)
diagram({
  ox: -D2.x, oy: -D2.y,
  blade: [[327, 590], [319, 612], [316, 660], [319, 705], [323, 737], [340, 737], [342, 700], [339, 640], [335, 608], [327, 590]],
  hub: [[380, 735], [335, 738], [295, 755], [270, 778], [265, 788], [272, 800], [300, 822], [340, 838], [380, 841]],
  hubBackX: 380, hubTopY: 735, hubBottomY: 841, centerY: 788,
  hatch: { coils: Array.from({ length: 6 }, (_, i) => [[284 + 14 * i, 815], [298 + 14 * i, 763]]), axis: [[272, 788], [378, 788]] },
  shaft: [375, 780, 212, 15], innerShaft: [[395, 788], [585, 788]], box: [578, 722, 100, 126], small: [587, 762, 25, 56], bar: [612, 782, 216, 13],
  lever: { ellipse: [717, 633], rect: [680, 660, 33, 12], line: [[712, 641], [645, 726]] },
  texts: [
    { x: 779, y: 630, text: "Prop Lever" },
    { x: 464, y: 690, text: "Primary Govenor" },
    { x: 753, y: 725, text: "Engine Oil Pressure" },
    { x: 40, y: 754, text: "Oil pressure compresses\nspring, faster RPM", color: "text" },
  ],
  arrows: [
    [[772, 643], [755, 640], [736, 639]],
    [[577, 714], [588, 735], [595, 762]],
    [[800, 751], [787, 770], [772, 790]],
    [[214, 749], [220, 725], [250, 708], [300, 716], [350, 748], [392, 788]],
  ],
});

// ---------------------------------------------------------------- text measuring and outlines
const LINE = 1.25;
function layout(text, size) {
  const k = size / font.unitsPerEm;
  const lines = text.split("\n").map((t) => {
    const run = font.layout(t);
    return { run, width: run.positions.reduce((a, p) => a + p.xAdvance, 0) * k };
  });
  return { k, lines, width: Math.max(...lines.map((l) => l.width)), height: lines.length * size * LINE };
}
/** SVG path data for a text block (glyph outlines, so no font is needed to display it). */
function textPath(e) {
  const { k, lines } = layout(e.text, e.size);
  const lh = e.size * LINE;
  const parts = [];
  lines.forEach((l, i) => {
    const baseline = e.y + i * lh + (lh - (font.ascent - font.descent) * k) / 2 + font.ascent * k;
    let x = e.x;
    l.run.glyphs.forEach((g, gi) => {
      const pos = l.run.positions[gi];
      const d = g.path.toSVG();
      if (d) parts.push(`<path d="${d}" transform="matrix(${k} 0 0 ${-k} ${x + pos.xOffset * k} ${baseline - pos.yOffset * k})"/>`);
      x += pos.xAdvance * k;
    });
  });
  return parts.join("");
}

// ---------------------------------------------------------------- bounds -> card layout
const CARD_W = 950, CARD_H = 446, GAP = 24;
const cards = [0, 1].map((i) => ({ x: 0, y: i * (CARD_H + GAP) }));
const W = CARD_W, H = CARD_H * 2 + GAP;

// ---------------------------------------------------------------- SVG (hand-drawn look)
const rounded = ({ x, y, w, h, r }) =>
  `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;

const arrowHead = (pts, len = 15, spread = 0.46) => {
  const [bx, by] = pts[pts.length - 2];
  const [tx, ty] = pts[pts.length - 1];
  const a = Math.atan2(ty - by, tx - bx);
  return [Math.PI - spread, Math.PI + spread].map((s) => [[tx, ty], [tx + len * Math.cos(a + s), ty + len * Math.sin(a + s)]]);
};

function roughPaths(e) {
  const color = SHOW[e.color ?? "line"];
  const o = { seed: e.seed, roughness: 1, bowing: 1, stroke: color, strokeWidth: e.width ?? (e.thin ? 1.6 : 2) };
  const drawables = [];
  if (e.kind === "rect") drawables.push(gen.path(rounded(e), { ...o, ...(e.fill ? { fill: SHOW.olive, fillStyle: "solid" } : {}) }));
  else if (e.kind === "ellipse") drawables.push(gen.ellipse(e.cx, e.cy, e.w, e.h, o));
  else if (e.kind === "curve") drawables.push(gen.curve(e.pts, o));
  else if (e.kind === "line") drawables.push(gen.linearPath(e.pts, o));
  else if (e.kind === "arrow") {
    drawables.push(e.pts.length > 2 ? gen.curve(e.pts, o) : gen.linearPath(e.pts, o));
    for (const seg of arrowHead(e.pts)) drawables.push(gen.linearPath(seg, { ...o, seed: e.seed + 1 }));
  }
  return drawables.flatMap((d) => gen.toPaths(d));
}

const ALT = "Turboprop propeller governor: a spring pushes the blades to feather; engine oil pressure compresses the spring for a faster RPM.";
function makeSvg(elements, cardCount, width, height) {
  const parts = [];
  for (let i = 0; i < cardCount; i++) parts.push(`<rect x="0" y="${cards[i].y}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${SHOW.card}"/>`);
  for (const e of elements) {
    if (e.kind === "text") {
      parts.push(`<g fill="${SHOW[e.color]}">${textPath(e)}</g>`);
      continue;
    }
    for (const p of roughPaths(e)) {
      parts.push(`<path d="${p.d}" fill="${p.fill ?? "none"}" stroke="${p.stroke === "none" ? "none" : p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ALT}">\n<title>Turbo propeller systems</title>\n${parts.join("\n")}\n</svg>\n`;
}
const svg = makeSvg(scene, 2, W, H); // both diagrams, tall: the wide-layout hero
const banner = makeSvg(scene.slice(0, D1_COUNT), 1, CARD_W, CARD_H); // diagram 1 only: the narrow-layout banner

// ---------------------------------------------------------------- .excalidraw file
let n = 0;
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const index = (i) => (i < 62 ? `a${B62[i]}` : `b${B62[Math.floor((i - 62) / 62)]}${B62[(i - 62) % 62]}`);
const id = () => `tp${(++n).toString(36).padStart(4, "0")}`;
const base = (e, extra) => ({
  id: id(), angle: 0, backgroundColor: "transparent", fillStyle: "solid", strokeStyle: "solid", roughness: 1, opacity: 100,
  groupIds: [], frameId: null, index: index(n), seed: e.seed, version: 1, versionNonce: e.seed * 7, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false, ...extra,
});
const col = (c) => SAVE[c ?? "line"];
const linear = (e, type, extra = {}) => {
  const [x0, y0] = e.pts[0];
  const xs = e.pts.map((p) => p[0]), ys = e.pts.map((p) => p[1]);
  return base(e, {
    type, x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    strokeColor: col(e.color), strokeWidth: e.width ?? (e.thin ? 1 : 2), roundness: e.pts.length > 2 || e.kind === "curve" ? { type: 2 } : null,
    points: e.pts.map(([x, y]) => [x - x0, y - y0]), lastCommittedPoint: null, startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null, ...extra,
  });
};
const elements = scene.map((e) => {
  if (e.kind === "rect") {
    return base(e, { type: "rectangle", x: e.x, y: e.y, width: e.w, height: e.h, strokeColor: col("line"), strokeWidth: 2, backgroundColor: e.fill ? SAVE.olive : "transparent", roundness: { type: 3 } });
  }
  if (e.kind === "ellipse") return base(e, { type: "ellipse", x: e.cx - e.w / 2, y: e.cy - e.h / 2, width: e.w, height: e.h, strokeColor: col("line"), strokeWidth: 2, roundness: { type: 2 } });
  if (e.kind === "text") {
    const m = layout(e.text, e.size);
    return base(e, {
      type: "text", x: e.x, y: e.y, width: Math.ceil(m.width), height: m.height, strokeColor: col(e.color === "text" ? "text" : e.color), strokeWidth: 1,
      roundness: null, text: e.text, fontSize: e.size, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null,
      originalText: e.text, autoResize: true, lineHeight: LINE,
    });
  }
  return linear(e, e.kind === "arrow" ? "arrow" : "line");
});

const file = { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {} };

await writeFile(new URL("turboprop.excalidraw", OUT), JSON.stringify(file, null, 2));
await writeFile(new URL("turboprop.svg", OUT), svg);
await sharp(Buffer.from(svg), { density: 192 }).png().toFile(new URL("turboprop.png", OUT).pathname);
await copyFile(new URL("turboprop.svg", OUT), new URL("../assets/login-art.svg", import.meta.url));
await writeFile(new URL("../assets/login-banner.svg", import.meta.url), banner);
console.log(`elements: ${elements.length}, svg ${W}x${H}, text widths:`, ["Engine Oil Pressure", "Prop Lever", "Primary Govenor", "Gigantic Spring"].map((t) => `${t}=${Math.round(layout(t, 20).width)}`).join(" "));
