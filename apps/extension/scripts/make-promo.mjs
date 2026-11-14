import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
<rect width="440" height="280" fill="#faf9f5"/>
<g transform="translate(40,52) scale(0.9)">
  <rect width="128" height="128" rx="30" fill="#d97757"/>
  <path d="M40 86 C24 86 14 76 14 64 C14 53 23 45 34 45 C35 32 46 24 59 24 C72 24 81 32 84 43 C96 43 106 52 106 64 C106 76 97 86 84 86 Z" fill="none" stroke="#faf9f5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <g transform="translate(88,100) rotate(-45)"><rect x="-9" y="-44" width="18" height="44" rx="3" fill="#141413"/><rect x="-9" y="-44" width="18" height="11" rx="3" fill="#faf9f5"/><path d="M-9 0 L0 17 L9 0 Z" fill="#faf9f5" stroke="#141413" stroke-width="3.5" stroke-linejoin="round"/><path d="M-3.2 9 L0 17 L3.2 9 Z" fill="#141413"/></g>
</g>
<text x="40" y="206" font-family="Georgia, 'Times New Roman', serif" font-size="52" font-weight="500" fill="#141413">Ink<tspan fill="#b85634">drive</tspan></text>
<text x="40" y="240" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#5e5d59">Your drawings, saved privately in the cloud.</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(new URL("../../../store/promo-440x280.png", import.meta.url).pathname);
