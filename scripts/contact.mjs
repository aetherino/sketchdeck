// Tile PNGs into one contact sheet. Usage: node scripts/contact.mjs <out.png> <cols> <img...>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [out, cols, ...imgs] = process.argv.slice(2);
const cells = imgs
  .map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}"><figcaption>${path.basename(f)}</figcaption></figure>`)
  .join("");
const html = `<style>body{margin:0;background:#ddd;font:14px system-ui}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px}
figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px;color:#444}</style><main>${cells}</main>`;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1900, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
