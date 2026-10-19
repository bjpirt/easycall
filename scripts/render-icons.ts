/**
 * Renders scripts/icon.svg to the PNG icons in public/icons (run with
 * `npm run icons` after changing the SVG; the PNGs are committed).
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("scripts/icon.svg", "utf8");
const sizes = { "icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180 };

const browser = await chromium.launch();
for (const [file, size] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/icons/${file}` });
  await page.close();
  console.log(`public/icons/${file}`);
}
await browser.close();
