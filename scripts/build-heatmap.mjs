#!/usr/bin/env node
/**
 * Build GitHub contribution heatmap SVGs (light + dark) with a Tsinghua-purple
 * frequency scale. Empty days render dark (or light gray in light theme).
 *
 * Data: GitHub GraphQL contributionCalendar for one user.
 * Usage:
 *   GITHUB_TOKEN=... node scripts/build-heatmap.mjs          # fetch from API
 *   node scripts/build-heatmap.mjs --input calendar.json     # use pre-fetched JSON
 *
 * Outputs heatmap-light.svg / heatmap-dark.svg into the current directory.
 */
import { readFileSync, writeFileSync } from "node:fs";

const USER = "Proud88";

// Tsinghua purple base #660874; four frequency levels, brightest = busiest.
const SCALE = {
  light: ["#E4D3EC", "#C79FD6", "#9A4FAE", "#660874"],
  dark: ["#33203F", "#4E2C60", "#7A3D91", "#B366CE"],
};
const EMPTY = { light: "#EBEDF0", dark: "#1F2630" };
const TEXT = { light: "#656D76", dark: "#8B949E" };

const CELL = 11, GAP = 3, PITCH = CELL + GAP;
const LEFT = 38, TOP = 24;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function level(count) {
  if (!count || count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

async function fetchCalendar() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required when --input is not used");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `query($login:String!){ user(login:$login){ contributionsCollection {
        contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`,
      variables: { login: USER },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function buildSvg(weeks, theme) {
  const cols = weeks.length;
  const width = LEFT + cols * PITCH + 2;
  const height = TOP + 7 * PITCH + 4;

  const cells = [];
  weeks.forEach((week, i) => {
    week.contributionDays.forEach((day, j) => {
      if (!day) return;
      const lv = level(day.contributionCount);
      const fill = lv === 0 ? EMPTY[theme] : SCALE[theme][lv - 1];
      cells.push(`<rect width="${CELL}" height="${CELL}" rx="2" x="${LEFT + i * PITCH}" y="${TOP + j * PITCH}" fill="${fill}"/>`);
    });
  });

  // Month label at the first week of each new month; avoid collisions and the right edge.
  const labels = [];
  let lastX = -Infinity;
  weeks.forEach((week, i) => {
    const first = week.contributionDays.find(Boolean);
    if (!first) return;
    const d = new Date(first.date + "T00:00:00Z");
    const prev = i > 0 && weeks[i - 1].contributionDays.find(Boolean);
    const prevD = prev && new Date(prev.date + "T00:00:00Z");
    if (i === 0 || (prevD && d.getUTCMonth() !== prevD.getUTCMonth())) {
      const x = LEFT + i * PITCH;
      if (x - lastX >= 3 * PITCH && i <= cols - 3) {
        labels.push(`<text x="${x}" y="15" class="label">${MONTHS[d.getUTCMonth()]}</text>`);
        lastX = x;
      }
    }
  });

  const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]]
    .map(([r, t]) => `<text x="${LEFT - 8}" y="${TOP + r * PITCH + 9}" text-anchor="end" class="label">${t}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub contribution calendar for ${USER}">
<style>.label{fill:${TEXT[theme]};font:10px 'Segoe UI',Helvetica,Arial,sans-serif;}</style>
${labels.join("")}${dayLabels}${cells.join("")}
</svg>`;
}

const inputIdx = process.argv.indexOf("--input");
let calendar;
if (inputIdx > -1) {
  calendar = JSON.parse(readFileSync(process.argv[inputIdx + 1], "utf8"));
  calendar = calendar.contributionCalendar ?? calendar;
} else {
  calendar = await fetchCalendar();
}

const weeks = calendar.weeks;
writeFileSync("heatmap-light.svg", buildSvg(weeks, "light"));
writeFileSync("heatmap-dark.svg", buildSvg(weeks, "dark"));

const days = weeks.flatMap((w) => w.contributionDays).filter(Boolean);
const total = days.reduce((s, d) => s + (d.contributionCount || 0), 0);
const active = days.filter((d) => (d.contributionCount || 0) > 0).length;
console.log(`OK: ${days.length} days, ${total} contributions on ${active} active days`);
