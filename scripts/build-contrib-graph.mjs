#!/usr/bin/env node
/**
 * Build a GitHub-native-style contribution graph SVG (light + dark):
 * yearly total line, month labels on top, Mon/Wed/Fri on the left,
 * Less/More legend at the bottom right, bordered panel.
 * Purple palette per owner's preference; swap PALETTE levels for native green.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/build-contrib-graph.mjs [--out dist]
 *   node scripts/build-contrib-graph.mjs --input calendar.json [--out dist]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const USER = "Proud88";

const PALETTE = {
  light: {
    panel: "#FFFFFF", panelStroke: "#D1D9E0B3",
    empty: "#EBEDF0",
    levels: ["#E4D3EC", "#C79FD6", "#9A4FAE", "#660874"],
    text: "#656D76", strong: "#1F2328",
  },
  dark: {
    panel: "#0D1117", panelStroke: "#3D444DB3",
    empty: "#161B22",
    levels: ["#33203F", "#4E2C60", "#7A3D91", "#B366CE"],
    text: "#7D8590", strong: "#E6EDF3",
  },
};

const CELL = 10, GAP = 3, PITCH = CELL + GAP;
const GRID_X = 34, GRID_Y = 44;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const levelOf = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

async function fetchCalendar() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required when --input is not used");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `query($login:String!){ user(login:$login){ contributionsCollection {
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`,
      variables: { login: USER },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function buildSvg(weeks, theme, total) {
  const p = PALETTE[theme];
  const cols = weeks.length;
  const gridW = cols * PITCH - GAP;
  const gridH = 7 * PITCH - GAP;
  const gridRight = GRID_X + gridW;
  const swatchY = GRID_Y + gridH + 14;
  const width = gridRight + 44;
  const height = swatchY + CELL + 8;

  const parts = [];
  parts.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${p.panel}" stroke="${p.panelStroke}"/>`);
  parts.push(
    `<text x="${GRID_X}" y="22" class="t">${total} contribution${total === 1 ? "" : "s"} in the last year</text>`
  );

  // Month label at the first week whose Sunday opens a new month.
  let prevM = -1;
  weeks.forEach((week, i) => {
    const first = week.contributionDays[0];
    if (!first) return;
    const m = new Date(first.date + "T00:00:00Z").getUTCMonth();
    const x = GRID_X + i * PITCH;
    if (m !== prevM && x <= gridRight - 26) {
      parts.push(`<text x="${x}" y="${GRID_Y - 10}" class="m">${MONTHS[m]}</text>`);
      prevM = m;
    }
  });

  // Weekday labels: rows are Sun..Sat, mark Mon/Wed/Fri.
  [1, 3, 5].forEach((row, idx) => {
    parts.push(`<text x="${GRID_X - 9}" y="${GRID_Y + row * PITCH + 8}" text-anchor="end" class="w">${["Mon", "Wed", "Fri"][idx]}</text>`);
  });

  weeks.forEach((week, i) => {
    week.contributionDays.forEach((day, j) => {
      if (!day) return;
      const lv = levelOf(day.contributionCount);
      parts.push(
        `<rect x="${GRID_X + i * PITCH}" y="${GRID_Y + j * PITCH}" width="${CELL}" height="${CELL}" rx="2" fill="${lv === 0 ? p.empty : p.levels[lv - 1]}"/>`
      );
    });
  });

  // Legend: Less [5 swatches] More, right-aligned to the grid.
  const legendW = 5 * CELL + 4 * GAP;
  parts.push(`<text x="${gridRight - legendW - 9}" y="${swatchY + 8}" text-anchor="end" class="l">Less</text>`);
  for (let k = 0; k < 5; k++) {
    parts.push(
      `<rect x="${gridRight - legendW + k * (CELL + GAP)}" y="${swatchY}" width="${CELL}" height="${CELL}" rx="2" fill="${k === 0 ? p.empty : p.levels[k - 1]}"/>`
    );
  }
  parts.push(`<text x="${gridRight + 9}" y="${swatchY + 8}" class="l">More</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub contribution graph for ${USER}">
<style>.m,.w,.l{fill:${p.text};font:10px ${FONT};}.t{fill:${p.strong};font:600 12px ${FONT};}</style>
${parts.join("\n")}
</svg>`;
}

const argv = process.argv;
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : ".";
let calendar;
const inputIdx = argv.indexOf("--input");
if (inputIdx > -1) {
  calendar = JSON.parse(readFileSync(argv[inputIdx + 1], "utf8"));
  calendar = calendar.contributionCalendar ?? calendar;
} else {
  calendar = await fetchCalendar();
}

const weeks = calendar.weeks;
const total = calendar.totalContributions ?? weeks.flatMap((w) => w.contributionDays).reduce((s, d) => s + (d?.contributionCount || 0), 0);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "contribution-graph-light.svg"), buildSvg(weeks, "light", total));
writeFileSync(join(outDir, "contribution-graph-dark.svg"), buildSvg(weeks, "dark", total));
const days = weeks.flatMap((w) => w.contributionDays).filter(Boolean);
console.log(`OK: ${days.length} days, ${total} contributions (grid ${weeks.length} weeks)`);
