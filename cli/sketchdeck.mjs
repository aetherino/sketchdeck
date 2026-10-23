#!/usr/bin/env node
// sketchdeck — the agent's tools.
//
//   sketchdeck dev    <deck.ts> [--port 5173]          present with live reload
//   sketchdeck check  <deck.ts> [--strict] [--no-types] types, validation, layout lint
//   sketchdeck render <deck.ts> [--out dir] [--step N] [--frames K] [--theme paper|chalk]
//                                                     PNG per step (+ mid-unfold frames)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, deckArg, ...rest] = process.argv.slice(2);

const flag = (name) => rest.includes(`--${name}`);
const option = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback;
};

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/** Relative to the working directory when inside it, absolute otherwise. */
function pretty(p) {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith("..") ? p : rel || ".";
}

function usage(code = 1) {
  console.log(`usage:
  sketchdeck dev    <deck.ts> [--port 5173]
  sketchdeck check  <deck.ts> [--strict] [--no-types]
  sketchdeck render <deck.ts> [--out <dir>] [--step N] [--frames K] [--theme paper|chalk]`);
  process.exit(code);
}

if (!command || command === "help" || command === "--help") usage(0);
if (!["dev", "check", "render"].includes(command) || !deckArg) usage();
const deck = path.resolve(deckArg);
if (!fs.existsSync(deck)) {
  console.error(red(`no deck at ${deck}`));
  process.exit(1);
}

/** A Vite server presenting the deck. vite.config.ts reads SKETCHDECK_DECK. */
async function serve(port, quiet) {
  process.env.SKETCHDECK_DECK = deck;
  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.ts"),
    server: { port, strictPort: false },
    logLevel: quiet ? "error" : "info",
    clearScreen: false,
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
  return { server, url };
}

/** Load the deck and run schema + cross-reference validation in Node. */
async function validate(server) {
  const mod = await server.ssrLoadModule(deck);
  const { validate, DeckError } = await server.ssrLoadModule("/src/core/validate.ts");
  try {
    return { deck: validate(mod.default), issues: [] };
  } catch (e) {
    if (e instanceof DeckError || e?.issues) return { deck: undefined, issues: e.issues };
    throw e;
  }
}

function typecheck() {
  const tmp = path.join(ROOT, `.tsconfig.check.${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    extends: "./tsconfig.json",
    include: [path.join(ROOT, "src/types"), deck],
  }));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", tmp], {
      cwd: ROOT, encoding: "utf8",
    });
    const out = (r.stdout + r.stderr).trim();
    // Only report problems in the deck itself, as "deck.ts:line:col message".
    const name = pretty(deck);
    return out
      .split("\n")
      .filter((l) => l.includes(path.basename(deck)))
      .map((l) => l.replace(/^.*\((\d+),(\d+)\): error TS\d+: /, `${name}:$1:$2 `));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function withPage(url, fn, query = "") {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${url}?step=1${query}`);
    // Ready, or broken: Vite shows an error overlay when the code fails to build.
    await page.waitForFunction(
      () => window.__sketchdeck?.ready === true || document.querySelector("vite-error-overlay") !== null,
      null, { timeout: 30000 },
    );
    const overlay = await page.evaluate(() => document.querySelector("vite-error-overlay")?.shadowRoot?.querySelector(".message")?.textContent);
    if (overlay) throw new Error(`the deck failed to build:\n${overlay.trim()}`);
    if (errors.length) throw new Error(`page error: ${errors.join("; ")}`);
    await page.waitForTimeout(400); // let text finish laying out
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function printIssues(title, issues, color) {
  if (!issues.length) return;
  console.log(color(`${title} (${issues.length})`));
  for (const i of issues) console.log(`  ${color("•")} ${typeof i === "string" ? i : i.message}`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function dev() {
  const { url } = await serve(Number(option("port", 5173)), false);
  console.log(`\n  ${green("sketchdeck")} presenting ${pretty(deck)}\n  ${url}\n`);
  console.log(dim("  → / space next   ← back   R replay step   (edits reload in place)\n"));
}

async function check() {
  const started = Date.now();
  let failed = false;

  if (!flag("no-types")) {
    const typeErrors = typecheck();
    printIssues("type errors", typeErrors, red);
    failed ||= typeErrors.length > 0;
  }

  const { server, url } = await serve(0, true);
  try {
    const { issues } = await validate(server);
    printIssues("deck problems", issues, red);
    if (issues.length) {
      process.exitCode = 1;
      return;
    }
    const lint = await withPage(url, (page) => page.evaluate(() => window.__sketchdeck.lint()));
    printIssues("layout warnings", lint, yellow);
    if (lint.length && flag("strict")) failed = true;
    if (!failed && !lint.length) console.log(green("✓ deck is valid and the layout is clean"));
    else if (!failed) console.log(green("✓ deck is valid") + dim(" — warnings above are worth a look"));
    console.log(dim(`  ${((Date.now() - started) / 1000).toFixed(1)}s`));
    if (failed) process.exitCode = 1;
  } finally {
    await server.close();
  }
}

async function render() {
  const out = path.resolve(option("out", path.join(path.dirname(deck), "out")));
  const only = option("step") ? Number(option("step")) - 1 : undefined;
  const frames = Number(option("frames", 0));
  fs.mkdirSync(out, { recursive: true });
  const started = Date.now();
  const { server, url } = await serve(0, true);
  try {
    const { issues } = await validate(server);
    if (issues.length) {
      printIssues("deck problems", issues, red);
      process.exitCode = 1;
      return;
    }
    const written = await withPage(url, async (page) => {
      const count = await page.evaluate(() => window.__sketchdeck.count);
      const files = [];
      const shoot = async (name, i, t) => {
        await page.evaluate(([i, t]) => window.__sketchdeck.goto(i, t ?? undefined), [i, t ?? null]);
        const file = path.join(out, name);
        await page.locator("#stage").screenshot({ path: file });
        files.push(file);
      };
      for (let i = 0; i < count; i++) {
        if (only !== undefined && i !== only) continue;
        const n = String(i + 1).padStart(2, "0");
        if (frames > 0) {
          const d = await page.evaluate((i) => window.__sketchdeck.duration(i), i);
          for (let f = 1; f <= frames; f++) await shoot(`step-${n}-${String(f).padStart(2, "0")}.png`, i, (d * f) / (frames + 1));
        }
        await shoot(`step-${n}.png`, i);
      }
      const lint = await page.evaluate(() => window.__sketchdeck.lint());
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ deck, steps: count, lint }, null, 2));
      printIssues("layout warnings", lint, yellow);
      return files;
    }, option("theme") ? `&theme=${option("theme")}` : "");
    console.log(green(`✓ ${written.length} image${written.length === 1 ? "" : "s"} → ${pretty(out)}`));
    console.log(dim(`  report.json has the layout warnings · ${((Date.now() - started) / 1000).toFixed(1)}s`));
  } finally {
    await server.close();
  }
}

try {
  await { dev, check, render }[command]();
} catch (e) {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
