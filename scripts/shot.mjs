// Capture the running dev page at full stage resolution.
// Usage: node scripts/shot.mjs <out.png> [url] [--key D --wait ms]
import { chromium } from "playwright-core";

const [out = "shot.png", url = "http://localhost:5173/", ...rest] = process.argv.slice(2);
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};

const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
await page.waitForTimeout(500);
const key = opt("key");
if (key) await page.keyboard.press(key);
await page.waitForTimeout(Number(opt("wait", 0)));
await page.locator("#stage").screenshot({ path: out });
await browser.close();
console.log(out);
