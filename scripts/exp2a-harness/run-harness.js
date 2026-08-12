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

console.log("\n=== 2. respondent-level processSlots ===");
const resp = JSON.parse(fs.readFileSync(path.join(__dirname, "respondents.json"), "utf8"));
const usableDist = { "0": 0, "1": 0, "2": 0, "3plus": 0 };
let nTrigger = 0;
for (const r of resp.respondents) {
  const slots = r.slots.map((t, i) => ({ text: t, domain: E.DOMAINS[Math.floor(i / 3)] }));
  const out = E.processSlots(slots);
  if ("expectUsable" in r && out.pairs.length !== r.expectUsable) {
    fail(`${r.label}: usable expected ${r.expectUsable}, got ${out.pairs.length}`);
  }
  if ("expectNeedsLlm" in r && out.needsLlm !== r.expectNeedsLlm) {
    fail(`${r.label}: needsLlm expected ${r.expectNeedsLlm}, got ${out.needsLlm}`);
  }
  if (r.expectSelected) {
    const sel = E.selectPairs(out.pairs, 3).map(p => p.name);
    if (JSON.stringify(sel) !== JSON.stringify(r.expectSelected)) {
      fail(`${r.label}: selected ${JSON.stringify(sel)} != ${JSON.stringify(r.expectSelected)}`);
    }
  }
  if (r.expectNoBadChars) {
    for (const p of out.pairs) {
      if (/["\\`<>]/.test((p.name || "") + (p.rel || ""))) { fail(`${r.label}: unsanitized pair`); }
    }
    for (const q of out.residue) {
      if (/["\\`<>]/.test(q.text)) { fail(`${r.label}: unsanitized residue`); }
    }
  }
  const n = out.pairs.length;
  usableDist[n >= 3 ? "3plus" : String(n)]++;
  if (out.needsLlm) { nTrigger++; }
}
console.log("usable-name distribution across fixtures:", usableDist);
console.log(`LLM trigger rate across fixtures: ${nTrigger}/${resp.respondents.length}`);

console.log("\n=== 3. template render pass ===");
const TPL = {};
for (const v of ["tie-named-3", "tie-named-2", "tie-generic", "placebo"]) {
  TPL[v] = fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "templates", v + ".txt"), "utf8").trim();
}
function checkText(label, text) {
  if (/\[[A-Z_0-9]+\]/.test(text)) { fail(`${label}: unfilled token\n${text}`); }
  if (/[ \t]{2,}|[ \t][,.]/.test(text)) { fail(`${label}: spacing problem\n${text}`); }
  if (text.indexOf("undefined") !== -1 || text.indexOf("null") !== -1) { fail(`${label}: undefined/null leaked`); }
  if (/\(your [^)]*\(your/.test(text)) { fail(`${label}: nested rel clause`); }
  if (/your your/.test(text)) { fail(`${label}: doubled 'your'`); }
}
const P = (name, rel, cls) => ({ name, rel, cls, domains: ["money"], firstIndex: 0 });
const renderCases = [
  ["named3 full",        "tie-named-3", [P("Maria","sister","named_rel"), P("James","neighbor","named_rel"), P("Tara","coworker","named_rel")]],
  ["named3 name-only",   "tie-named-3", [P("Pastor Williams",null,"name_only"), P("Maria","sister","named_rel"), P("DeShawn",null,"name_only")]],
  ["named3 rel-only mix","tie-named-3", [P("Maria","sister","named_rel"), P(null,"mom","rel_only"), P("O'Brien",null,"name_only")]],
  ["named2",             "tie-named-2", [P("Maria","sister","named_rel"), P(null,"childhood friend","rel_only")]],
  ["generic",            "tie-generic", []],
  ["placebo",            "placebo",     []]
];
for (const [label, v, sel] of renderCases) {
  const text = E.composeStimulus(TPL[v], sel);
  checkText(label, text);
}
// print two renders for eyeballing
console.log("\n--- named3 rel-only mix ---\n" +
  E.composeStimulus(TPL["tie-named-3"], [P("Maria","sister","named_rel"), P(null,"mom","rel_only"), P("O'Brien",null,"name_only")]));
console.log("\n--- named2 ---\n" +
  E.composeStimulus(TPL["tie-named-2"], [P("Maria","sister","named_rel"), P(null,"childhood friend","rel_only")]));

// decideVariant truth table
const dv = [["tie",5,"named3",0],["tie",3,"named3",0],["tie",2,"named2",0],["tie",1,"generic",1],["tie",0,"generic",1],["placebo",4,"placebo",0]];
for (const [arm,n,variant,lowTie] of dv) {
  const got = E.decideVariant(arm, n);
  if (got.variant !== variant || got.lowTie !== lowTie) {
    fail(`decideVariant(${arm},${n}): got ${JSON.stringify(got)}, want ${variant}/${lowTie}`);
  }
}

console.log("\n=== 4. residue + LLM merge (mocked) ===");
const det = [
  { name: "Maria", rel: "sister", cls: "named_rel", domains: ["transport"], firstIndex: 0 }
];
const residue = [
  { text: "my ride or die", domain: "job", index: 3 },
  { text: "karen my wifes friend", domain: "money", index: 6 },
  { text: "the church ladies", domain: "other", index: 9 }
];
const rs = E.buildResidueString(residue);
if (rs !== "job: my ride or die ||| money: karen my wifes friend ||| other: the church ladies") {
  fail("buildResidueString: got " + rs);
}
if (/["\\`<>\n]/.test(rs)) { fail("residue string contains unsafe chars"); }

// valid mock: rescues 2 entries, one is a group (dropped), one echoes Maria (deduped)
const okMock = JSON.stringify({ entries: [
  { text: "my ride or die", name: "Denise", relationship: "best friend", category: "friend", usable: true },
  { text: "karen my wifes friend", name: "Karen", relationship: "friend", category: "friend", usable: true },
  { text: "the church ladies", name: null, relationship: null, category: "group", usable: false }
]});
let merged = E.mergeLlm(det, okMock, residue);
if (merged.length !== 3) { fail(`mergeLlm ok: expected 3 pairs, got ${merged.length}`); }
if (merged.map(p => p.name).join(",") !== "Maria,Denise,Karen") { fail("mergeLlm ok: wrong pairs " + merged.map(p => p.name)); }

// adversarial mocks: must never throw, must never let spouse/garbage through
for (const [label, raw, expectN] of [
  ["malformed JSON", "{oops", 1],
  ["empty string", "", 1],
  ["spouse smuggled", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"husband", category:"spouse_partner", usable:true}]}), 1],
  ["quote injection", JSON.stringify({entries:[{text:"x", name:'Eve"<script>', relationship:"friend", category:"friend", usable:true}]}), 2],
  ["bare array form", JSON.stringify([{text:"my ride or die", name:"Denise", relationship:"friend", category:"friend", usable:true}]), 2],
  ["spouse mis-cased", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"husband", category:"Spouse_Partner", usable:true}]}), 1],
  ["spouse padded category", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"husband", category:"spouse_partner ", usable:true}]}), 1],
  ["spouse missing category", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"husband", usable:true}]}), 1],
  ["spouse null category", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"husband", category:null, usable:true}]}), 1],
  ["spouse rel with benign category", JSON.stringify({entries:[{text:"x", name:"Sam", relationship:"wife", category:"friend", usable:true}]}), 1]
]) {
  let m;
  try { m = E.mergeLlm(det, raw, residue); } catch (e) { fail(`mergeLlm ${label}: threw ${e}`); continue; }
  if (m.length !== expectN) { fail(`mergeLlm ${label}: expected ${expectN}, got ${m.length}`); }
  for (const p of m) {
    if (/["\\`<>]/.test((p.name || "") + (p.rel || ""))) { fail(`mergeLlm ${label}: unsanitized output`); }
  }
}

if (nBad > 0) { console.error(`\nFAILED: ${nBad} problems`); process.exit(1); }
console.log("\nall harness sections passed");
