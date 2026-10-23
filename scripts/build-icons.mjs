// Converts a curated set of Lucide glyphs and Simple Icons brand marks into
// polylines the sketch style can roughen. Run after changing the lists below:
//   node scripts/build-icons.mjs
// Writes src/styles/sketch/icons.json (geometry) and src/schema/icons.ts (names).

import fs from "node:fs";
import { icons as lucide } from "lucide";
import svgpath from "svgpath";

// name → Lucide component name. Stroke glyphs, drawn as lines.
const GLYPHS = {
  server: "Server", database: "Database", globe: "Globe", phone: "Smartphone", monitor: "Monitor",
  laptop: "Laptop", user: "User", users: "Users", lock: "Lock", key: "Key", shield: "Shield",
  "shield-check": "ShieldCheck", fingerprint: "Fingerprint", cpu: "Cpu", cloud: "Cloud", zap: "Zap",
  mail: "Mail", bell: "Bell", file: "File", folder: "Folder", archive: "Archive", settings: "Settings",
  search: "Search", "credit-card": "CreditCard", wallet: "Wallet", cart: "ShoppingCart", clock: "Clock",
  timer: "Timer", calendar: "Calendar", "git-branch": "GitBranch", box: "Box", package: "Package",
  container: "Container", layers: "Layers", code: "Code", braces: "Braces", terminal: "Terminal",
  activity: "Activity", chart: "ChartBar", gauge: "Gauge", dashboard: "LayoutDashboard",
  "hard-drive": "HardDrive", network: "Network", router: "Router", wifi: "Wifi", workflow: "Workflow",
  webhook: "Webhook", bot: "Bot", brain: "Brain", sparkles: "Sparkles", message: "MessageSquare",
  inbox: "Inbox", send: "Send", refresh: "RefreshCw", repeat: "Repeat", split: "Split", merge: "Merge",
  filter: "Filter", eye: "Eye", image: "Image", video: "Video", building: "Building", table: "Table",
  list: "ListOrdered", hash: "Hash", truck: "Truck", map: "Map",
};

// name → Simple Icons slug. Filled brand marks, drawn as outlined shapes.
const BRANDS = {
  postgres: "postgresql", redis: "redis", kafka: "apachekafka", kubernetes: "kubernetes",
  docker: "docker", cloudflare: "cloudflare", nginx: "nginx", react: "react", node: "nodedotjs",
  python: "python", go: "go", rust: "rust", typescript: "typescript", github: "github",
  stripe: "stripe", mongodb: "mongodb", mysql: "mysql", elasticsearch: "elasticsearch",
  rabbitmq: "rabbitmq", graphql: "graphql", vercel: "vercel", anthropic: "anthropic",
  terraform: "terraform", grafana: "grafana", prometheus: "prometheus", auth0: "auth0",
  okta: "okta", "google-cloud": "googlecloud",
};

const r = (v) => Math.round(v * 100) / 100;

function sampleCubic(p0, p1, p2, p3, out) {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const n = Math.max(2, Math.ceil(chord / 0.6));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

/** SVG path data → list of { points, closed }. */
function pathToPolylines(d) {
  const lines = [];
  let cur = null;
  let pos = [0, 0];
  let start = [0, 0];
  svgpath(d).abs().unarc().unshort().iterate((seg) => {
    const [cmd, ...a] = seg;
    if (cmd === "M") {
      if (cur && cur.points.length > 1) lines.push(cur);
      pos = [a[0], a[1]];
      start = pos;
      cur = { points: [pos], closed: false };
    } else if (cmd === "L") {
      pos = [a[0], a[1]];
      cur.points.push(pos);
    } else if (cmd === "H") {
      pos = [a[0], pos[1]];
      cur.points.push(pos);
    } else if (cmd === "V") {
      pos = [pos[0], a[0]];
      cur.points.push(pos);
    } else if (cmd === "C") {
      sampleCubic(pos, [a[0], a[1]], [a[2], a[3]], [a[4], a[5]], cur.points);
      pos = [a[4], a[5]];
    } else if (cmd === "Q") {
      const c1 = [pos[0] + (2 / 3) * (a[0] - pos[0]), pos[1] + (2 / 3) * (a[1] - pos[1])];
      const c2 = [a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3])];
      sampleCubic(pos, c1, c2, [a[2], a[3]], cur.points);
      pos = [a[2], a[3]];
    } else if (cmd === "Z" || cmd === "z") {
      cur.closed = true;
      lines.push(cur);
      pos = start;
      cur = { points: [pos], closed: false };
    }
  });
  if (cur && cur.points.length > 1) lines.push(cur);
  return lines;
}

function roundedRectPath(x, y, w, h, rx) {
  rx = Math.min(rx, w / 2, h / 2);
  if (!rx) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - 2 * rx}a${rx} ${rx} 0 0 1 ${-rx} ${rx}` +
    `h${-(w - 2 * rx)}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}v${-(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}z`;
}

function ellipsePath(cx, cy, rx, ry) {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
}

function lucideToPolylines(nodes) {
  const out = [];
  for (const [tag, at] of nodes) {
    const n = (k) => Number(at[k] ?? 0);
    let d;
    if (tag === "path") d = at.d;
    else if (tag === "rect") d = roundedRectPath(n("x"), n("y"), n("width"), n("height"), n("rx"));
    else if (tag === "circle") d = ellipsePath(n("cx"), n("cy"), n("r"), n("r"));
    else if (tag === "ellipse") d = ellipsePath(n("cx"), n("cy"), n("rx"), n("ry"));
    else if (tag === "line") d = `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    else if (tag === "polyline" || tag === "polygon") {
      const pts = at.points.trim().split(/[\s,]+/).map(Number);
      d = "M" + pts.join(" ") + (tag === "polygon" ? "z" : "");
    } else throw new Error(`unsupported lucide tag ${tag}`);
    out.push(...pathToPolylines(d));
  }
  return out;
}

const pack = (lines) => lines.map((l) => ({ c: l.closed ? 1 : 0, p: l.points.flatMap(([x, y]) => [r(x), r(y)]) }));

const data = {};
for (const [name, comp] of Object.entries(GLYPHS)) {
  if (!lucide[comp]) throw new Error(`lucide icon ${comp} not found`);
  data[name] = { type: "glyph", lines: pack(lucideToPolylines(lucide[comp])) };
}
for (const [name, slug] of Object.entries(BRANDS)) {
  const svg = fs.readFileSync(`node_modules/simple-icons/icons/${slug}.svg`, "utf8");
  const d = svg.match(/ d="([^"]+)"/)[1];
  data[name] = { type: "brand", lines: pack(pathToPolylines(d)) };
}

fs.writeFileSync("src/styles/sketch/icons.json", JSON.stringify(data));
const names = Object.keys(data).sort();
fs.writeFileSync(
  "src/schema/icons.ts",
  `// Generated by scripts/build-icons.mjs — do not edit.\nexport const ICON_NAMES = ${JSON.stringify(names, null, 2)} as const;\n`,
);
console.log(`${names.length} icons, ${(fs.statSync("src/styles/sketch/icons.json").size / 1024).toFixed(0)} KB`);
