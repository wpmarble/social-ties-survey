// Dev tool — not used by Qualtrics. Renders all 483 cells offline.
// Run: node exp2b-verify.js
const fs = require("fs");
const path = require("path");

const EXP2 = path.join(__dirname, "..", "exp2");
const T = f => fs.readFileSync(path.join(EXP2, "templates", f), "utf8").trim();
const tpl = { lede: T("lede.txt"), churn: T("stat-churn.txt"),
              decline: T("stat-decline.txt"), generic: T("stat-generic.txt") };
const lookup = JSON.parse(fs.readFileSync(path.join(EXP2, "exp2_lookup.json"), "utf8"));

function compose(cell) {
  const parts = [tpl.lede];
  if (cell.frame === "generic") { parts.push(tpl.generic); }
  else {
    if (cell.frame.indexOf("churn") !== -1) { parts.push(tpl.churn); }
    if (cell.frame.indexOf("decline") !== -1) { parts.push(tpl.decline); }
  }
  return parts.join("\n\n")
    .replace(/\[CHURN_UNIT\]/g,   cell.churn_unit)
    .replace(/\[CHURN_PCT\]/g,    cell.churn_pct)
    .replace(/\[CHURN_CLAUSE\]/g, cell.churn_clause)
    .replace(/\[DECLINE_UNIT\]/g, cell.decline_unit)
    .replace(/\[DECLINE_PCT\]/g,  cell.decline_pct);
}

let n = 0, bad = 0;
const counts = {};
for (let i = 1; i <= 21; i++) {
  for (let o = 1; o <= 23; o++) {
    const cell = lookup[String(i)][String(o)];
    const text = compose(cell);
    n++;
    counts[cell.frame] = (counts[cell.frame] || 0) + 1;
    // Note: [ \t] rather than \s — paragraphs are intentionally joined with
    // "\n\n", so a \s-based check would flag every multi-sentence render as
    // a false-positive spacing error. We only want to catch doubled spaces
    // or a stray space before a period WITHIN a rendered sentence.
    if (/\[[A-Z_]+\]/.test(text))       { bad++; console.error(`UNFILLED ${i},${o}: ${text}`); }
    if (/[ \t]{2,}|[ \t]\./.test(text)) { bad++; console.error(`SPACING  ${i},${o}: ${text}`); }
    if (text.indexOf("undefined") !== -1) { bad++; console.error(`UNDEF    ${i},${o}`); }
  }
}
console.log(`\nrendered ${n} cells`, counts);
console.log("\n--- retail(7) x office-admin(17) ---\n" + compose(lookup["7"]["17"]));
console.log("\n--- government(20) x manager(1) ---\n" + compose(lookup["20"]["1"]));
console.log("\n--- other(21) x other(23) ---\n" + compose(lookup["21"]["23"]));
console.log("\n--- decline-only sample: ag(1) x sales(16) ---\n" + compose(lookup["1"]["16"]));
if (bad > 0) { console.error(`\nFAILED: ${bad} problems`); process.exit(1); }
console.log("\nall cells rendered cleanly");
