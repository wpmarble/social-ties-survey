// Dev tool — Exp 2A offline harness. Run: node run-harness.js
// Section 1: entry-level classification against corpus.json.
// Later tasks append sections; the shared `fail()` counter gates exit status.
const fs = require("fs");
const path = require("path");
const E = require("../exp2a-core.js");

let nBad = 0;
function fail(msg) { nBad++; console.error("FAIL  " + msg); }

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.json"), "utf8"));

console.log("=== 1. entry classification ===");
const clsCounts = {};
for (const c of corpus.entries) {
  const cleaned = E.normalizeEntry(c.text);
  const got = cleaned === "" ? { cls: "unusable", name: null, rel: null } : E.classifyEntry(cleaned);
  clsCounts[got.cls] = (clsCounts[got.cls] || 0) + 1;
  if (got.cls !== c.expect) { fail(`"${c.text}": expected ${c.expect}, got ${got.cls}`); continue; }
  if (c.expect === "named_rel" || c.expect === "name_only" || c.expect === "rel_only") {
    if ((got.name || null) !== (c.name || null)) { fail(`"${c.text}": name expected ${c.name}, got ${got.name}`); }
    if ((got.rel || null) !== (c.rel || null))   { fail(`"${c.text}": rel expected ${c.rel}, got ${got.rel}`); }
  }
}
console.log("class counts:", clsCounts);
console.log(`residue (LLM-trigger) share of corpus entries: ${(100 * (clsCounts.residue || 0) / corpus.entries.length).toFixed(0)}%`);

if (nBad > 0) { console.error(`\nFAILED: ${nBad} problems`); process.exit(1); }
console.log("\nall harness sections passed");
