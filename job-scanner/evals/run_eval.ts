/**
 * run_eval.ts — scores filters.ts against hand-labeled real postings.
 *
 * Run (from job-scanner/):  npx tsx evals/run_eval.ts

 *
 * Dataset: filter_labels.jsonl, one real posting per line from past scanner results.
 *   expected_title: "newgrad" | "generic" | "reject"   (what a human says the title is)
 *   expected_us:    true | false                       (false = clearly outside the US)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTitle, locationIsUS } from "../filters.js";

type Row = { id: number; title: string; location: string; expected_title: string; expected_us: boolean };

const DIR = path.dirname(fileURLToPath(import.meta.url));
const rows: Row[] = readFileSync(path.join(DIR, "filter_labels.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// ── Title classifier: 3 classes ──
const classes = ["newgrad", "generic", "reject"];
const confusion: Record<string, Record<string, number>> = {};
for (const a of classes) confusion[a] = Object.fromEntries(classes.map((p) => [p, 0]));
const titleErrors: string[] = [];

for (const r of rows) {
  const got = classifyTitle(r.title);
  confusion[r.expected_title][got]++;
  if (got !== r.expected_title) titleErrors.push(`  #${r.id} "${r.title}"  expected ${r.expected_title}, got ${got}`);
}

const correct = classes.reduce((s, c) => s + confusion[c][c], 0);
console.log(`\nTITLE  accuracy ${correct}/${rows.length} (${((100 * correct) / rows.length).toFixed(1)}%)\n`);
console.log("confusion (rows = expected, columns = predicted)");
console.log("             " + classes.map((c) => c.padStart(8)).join(""));
for (const a of classes) console.log(a.padEnd(13) + classes.map((p) => String(confusion[a][p]).padStart(8)).join(""));

for (const c of classes) {
  const tp = confusion[c][c];
  const predicted = classes.reduce((s, a) => s + confusion[a][c], 0);
  const actual = classes.reduce((s, p) => s + confusion[c][p], 0);
  console.log(`  ${c.padEnd(8)} precision ${(tp / (predicted || 1)).toFixed(2)}  recall ${(tp / (actual || 1)).toFixed(2)}`);
}
if (titleErrors.length) console.log("\nTitle mistakes:\n" + titleErrors.join("\n"));

// ── Location filter: binary ──
let tp = 0, fp = 0, fn = 0, tn = 0;
const locErrors: string[] = [];
for (const r of rows) {
  const got = locationIsUS(r.location);
  if (got && r.expected_us) tp++;
  else if (got && !r.expected_us) { fp++; locErrors.push(`  #${r.id} "${r.location}"  let through, but not US`); }
  else if (!got && r.expected_us) { fn++; locErrors.push(`  #${r.id} "${r.location}"  blocked, but is US`); }
  else tn++;
}
console.log(`\nLOCATION  non-US blocked ${tn}/${tn + fp}   US kept ${tp}/${tp + fn}`);
if (locErrors.length) console.log("Location mistakes:\n" + locErrors.join("\n"));
console.log();
