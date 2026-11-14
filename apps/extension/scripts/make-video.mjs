// Builds the slides for the store promo video (1280x720). store/make-video.sh stitches them with ffmpeg.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

// A simple original doodle (not anyone else's artwork) to stand in for a drawing on the canvas.
const doodle = (x, y, w, h) => `<g transform="translate(${x},${y}) scale(${w / 520},${h / 240})" fill="none" stroke="#2a2926" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
<rect x="40" y="60" width="170" height="100" rx="10"/><ellipse cx="400" cy="110" rx="80" ry="55"/><path d="M212 110 C260 80 300 80 318 108"/><path d="M300 98 L320 110 L296 124"/>
<path d="M60 200 C150 230 300 230 450 190" stroke="#d97757"/></g>`;
const W = 1280, H = 720;
const mark = (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><rect width="128" height="128" rx="30" fill="#d97757"/>
<path d="M40 86 C24 86 14 76 14 64 C14 53 23 45 34 45 C35 32 46 24 59 24 C72 24 81 32 84 43 C96 43 106 52 106 64 C106 76 97 86 84 86 Z" fill="none" stroke="#faf9f5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<g transform="translate(88,100) rotate(-45)"><rect x="-9" y="-44" width="18" height="44" rx="3" fill="#141413"/><rect x="-9" y="-44" width="18" height="11" rx="3" fill="#faf9f5"/><path d="M-9 0 L0 17 L9 0 Z" fill="#faf9f5" stroke="#141413" stroke-width="3.5" stroke-linejoin="round"/><path d="M-3.2 9 L0 17 L3.2 9 Z" fill="#141413"/></g></g>`;
const serif = "Georgia, 'Times New Roman', serif", sans = "Helvetica, Arial, sans-serif";
const frame = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#faf9f5"/>${inner}</svg>`;
const title = (t, sub) => `<text x="80" y="150" font-family="${serif}" font-size="56" fill="#141413">${t}</text><text x="80" y="200" font-family="${sans}" font-size="26" fill="#5e5d59">${sub}</text>`;
const card = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="#ffffff" stroke="#e3dacc" stroke-width="2"/>`;
const row = (x, y, name, meta, tag) => `<rect x="${x}" y="${y}" width="500" height="64" rx="12" fill="#faf9f5" stroke="#eee6d9"/>
<rect x="${x + 16}" y="${y + 16}" width="32" height="32" rx="8" fill="#d97757" opacity=".85"/>
<text x="${x + 62}" y="${y + 30}" font-family="${sans}" font-size="20" font-weight="700" fill="#141413">${name}</text>
<text x="${x + 62}" y="${y + 52}" font-family="${sans}" font-size="15" fill="#5e5d59">${meta}</text>
${tag ? `<rect x="${x + 380}" y="${y + 20}" width="100" height="26" rx="13" fill="#f3dfd5"/><text x="${x + 430}" y="${y + 38}" text-anchor="middle" font-family="${sans}" font-size="14" font-weight="700" fill="#8a3f20">${tag}</text>` : ""}`;
const btn = (x, y, w, t, fill = "#b85634", tc = "#fff") => `<rect x="${x}" y="${y}" width="${w}" height="56" rx="14" fill="${fill}"/><text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" font-family="${sans}" font-size="22" font-weight="700" fill="${tc}">${t}</text>`;

const slides = [
  // 1 title
  frame(`${mark(80, 220, 1.5)}<text x="300" y="350" font-family="${serif}" font-size="120" fill="#141413">Ink<tspan fill="#b85634">drive</tspan></text>
<text x="304" y="420" font-family="${sans}" font-size="34" fill="#5e5d59">Your Excalidraw drawings, saved privately in the cloud.</text>`),
  // 2 problem
  frame(`${title("Excalidraw keeps your drawing in one browser", "Switch computers or clear your data, and it is gone.")}
${card(80, 270, 520, 330)}<text x="130" y="350" font-family="${sans}" font-size="26" fill="#141413">This computer</text><rect x="130" y="380" width="420" height="160" rx="12" fill="#faf9f5" stroke="#e3dacc"/><text x="340" y="470" text-anchor="middle" font-family="${sans}" font-size="22" fill="#5e5d59">your drawing</text>
${card(680, 270, 520, 330)}<text x="730" y="350" font-family="${sans}" font-size="26" fill="#141413">Another computer</text><text x="940" y="470" text-anchor="middle" font-family="${sans}" font-size="64" fill="#e3dacc">?</text>`),
  // 3 the button
  frame(`${title("Inkdrive lives inside Excalidraw", "One button next to the library. Nothing else changes.")}
${card(80, 270, 1120, 330)}<rect x="80" y="270" width="1120" height="70" rx="20" fill="#f5f2ea"/>
<rect x="840" y="286" width="170" height="40" rx="20" fill="#d97757"/><text x="925" y="313" text-anchor="middle" font-family="${sans}" font-size="20" font-weight="700" fill="#fff">Inkdrive</text>
<rect x="1030" y="286" width="150" height="40" rx="10" fill="#e3dacc"/><text x="1105" y="313" text-anchor="middle" font-family="${sans}" font-size="18" fill="#5e5d59">Library</text>
${doodle(320, 360, 520, 230)}`),
  // 4 sign in
  frame(`${title("Sign in with Google. That is all.", "No new password. We only get your name and email.")}
${card(380, 250, 520, 360)}${mark(600, 280, 0.6)}
<text x="640" y="400" text-anchor="middle" font-family="${serif}" font-size="34" fill="#141413">Welcome to Inkdrive</text>
${btn(430, 440, 420, "Continue with Google", "#ffffff", "#141413").replace('rx="14" fill="#ffffff"', 'rx="14" fill="#ffffff" stroke="#d6cdbd" stroke-width="2"')}
<text x="640" y="550" text-anchor="middle" font-family="${sans}" font-size="16" fill="#5e5d59">Only you can open your drawings</text>`),
  // 5 autosave
  frame(`${title("Draw. It saves itself.", "Autosave is on by default. Switch files and the last change is saved first.")}
${card(80, 270, 560, 330)}<text x="110" y="320" font-family="${sans}" font-size="22" font-weight="700" fill="#141413">Wing design</text>
<rect x="110" y="345" width="12" height="12" rx="6" fill="#4c9a6a"/><text x="132" y="357" font-family="${sans}" font-size="18" fill="#5e5d59">Saved just now</text>
${doodle(110, 385, 500, 200)}
${row(700, 290, "Wing design", "Updated just now", "")}${row(700, 370, "Hangar sketch", "2 min ago", "")}${row(700, 450, "Floor plan", "Yesterday", "")}`),
  // 6 organise
  frame(`${title("Folders, tags, search and history", "Find any drawing fast. Go back to an older version any time.")}
${card(80, 270, 1120, 330)}
${row(110, 300, "Aircraft", "Folder · 6 items", "")}${row(110, 380, "Wing design", "Updated just now", "Work")}${row(110, 460, "Floor plan", "Yesterday", "Ideas")}
<rect x="660" y="300" width="500" height="44" rx="22" fill="#faf9f5" stroke="#e3dacc"/><text x="690" y="329" font-family="${sans}" font-size="18" fill="#8a857a">Search your drawings</text>
<text x="660" y="400" font-family="${sans}" font-size="20" font-weight="700" fill="#141413">Version history</text>
<text x="660" y="436" font-family="${sans}" font-size="18" fill="#5e5d59">Revision 12 · just now</text><text x="660" y="468" font-family="${sans}" font-size="18" fill="#5e5d59">Revision 11 · 5 min ago   Restore</text><text x="660" y="500" font-family="${sans}" font-size="18" fill="#5e5d59">Revision 10 · yesterday   Restore</text>`),
  // 7 anywhere
  frame(`${title("Open it on any computer", "Install Inkdrive, sign in, and pick up where you left off.")}
${card(120, 280, 460, 300)}<text x="350" y="450" text-anchor="middle" font-family="${sans}" font-size="30" fill="#141413">Home</text>
${card(700, 280, 460, 300)}<text x="930" y="450" text-anchor="middle" font-family="${sans}" font-size="30" fill="#141413">Work</text>
<path d="M590 430 L690 430" stroke="#d97757" stroke-width="6" stroke-linecap="round"/><path d="M670 410 L692 430 L670 450" fill="none" stroke="#d97757" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  // 8 privacy
  frame(`${title("Private by design", "Encrypted in storage. Every account sees only its own drawings.")}
${card(80, 270, 1120, 330)}
<text x="130" y="350" font-family="${sans}" font-size="28" fill="#141413">• Drawings encrypted at rest (AES-256)</text>
<text x="130" y="410" font-family="${sans}" font-size="28" fill="#141413">• Sign-in only through Google</text>
<text x="130" y="470" font-family="${sans}" font-size="28" fill="#141413">• No ads, no tracking, no sharing</text>
<text x="130" y="545" font-family="${sans}" font-size="20" fill="#5e5d59">Honest note: not end-to-end encrypted. The server can read stored drawings to show them to you.</text>`),
  // 9 end
  frame(`${mark(560, 190, 1.2)}<text x="640" y="430" text-anchor="middle" font-family="${serif}" font-size="84" fill="#141413">Ink<tspan fill="#b85634">drive</tspan></text>
<text x="640" y="490" text-anchor="middle" font-family="${sans}" font-size="30" fill="#5e5d59">Get it free from the Chrome Web Store</text>`),
];
for (let i = 0; i < slides.length; i++) await sharp(Buffer.from(slides[i])).png().toFile(`${out}/s${i + 1}.png`);
console.log(`${slides.length} slides in ${out}`);
