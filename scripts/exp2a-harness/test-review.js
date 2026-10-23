// Dev tool — regression tests for the Phase 2e review findings (Exp 2A name selection / merge).
// Drives the BUILT bundles (exp2a-parse.js, exp2a-render.js) through parse -> simulated LLM -> render in node vm,
// plus direct core checks. Inputs are the reviewer's exact cases. Run: node test-review.js (after exp2a-build.js).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const E = require("../exp2a-core.js");

const SCRIPTS = path.join(__dirname, "..");
const PARSE = fs.readFileSync(path.join(SCRIPTS, "exp2a-parse.js"), "utf8");
const RENDER = fs.readFileSync(path.join(SCRIPTS, "exp2a-render.js"), "utf8");
const TPL = {};
for (const f of ["tie-named-3", "tie-named-2", "tie-generic", "placebo"]) {
  TPL[f + ".txt"] = fs.readFileSync(path.join(SCRIPTS, "..", "exp2a", "templates", f + ".txt"), "utf8");
}

// Qualtrics pipes raw ED into HTML and the hooks read textContent: decode entities once.
function htmlDecode(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
}

function runParse(slots9, page3) {
  const ed = {};
  const load = [], sub = [];
  const ctx = {
    console: { log() {}, error() {} },
    Qualtrics: { SurveyEngine: { addOnload: f => load.push(f), addOnPageSubmit: f => sub.push(f), setEmbeddedData: (k, v) => { ed[k] = String(v); } } },
    document: { getElementById: id => id === "exp2aPrior" ? { querySelectorAll: () => slots9.map(([t, d]) => ({ textContent: htmlDecode(t), getAttribute: () => d })) } : null },
    JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(PARSE, ctx);
  load[0].call({ getQuestionContainer: () => ({ querySelectorAll: () => page3.map(v => ({ value: v })) }) });
  sub[0]("next");
  return ed;
}

async function runRender(ed, llmRaw, status, opts) {
  opts = opts || {};
  const disp = { innerHTML: "" };
  const essay = { style: { display: "" }, className: "QuestionOuter" };
  const dom = {
    exp2aDisplay: disp, QID77: essay,
    "exp2a-det": { textContent: htmlDecode(ed.exp2a_det_pairs || "") },
    "exp2a-llm": { textContent: htmlDecode(llmRaw || "") },
    "exp2a-llmstatus": { textContent: status !== undefined ? status : (ed.exp2a_llm_status || "") },
    "exp2a-residue": { textContent: htmlDecode(ed.exp2a_residue || "") }
  };
  if (!opts.noSlotsSpan) { dom["exp2a-residue-slots"] = { textContent: htmlDecode(ed.exp2a_residue_slots || "") }; }
  const load = [];
  const ctx = {
    console: { log() {}, error() {} },
    Qualtrics: { SurveyEngine: { addOnload: f => load.push(f), setEmbeddedData: (k, v) => { ed[k] = String(v); } } },
    document: { getElementById: id => dom[id] || null },
    fetch: u => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(TPL[u.split("/").pop()] || "") }),
    Math, JSON, Promise, setTimeout: () => 0, clearTimeout: () => {}, AbortController: undefined
  };
  vm.createContext(ctx);
  vm.runInContext(RENDER.split("${e://Field/exp2a_arm}").join("tie").split("${e://Field/resp_id}").join("R_x"), ctx);
  load.forEach(f => f.call({ getQuestionContainer: () => null }));
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return { ed, html: disp.innerHTML };
}

const ALL_TEXTS = [];   // every stimulus produced, for the invariant test

// s: {transport:[..3], job:[..3], money:[..3], other:[..3]}; llm: (rows)->entries array | raw string
async function scenario(s, llm, opts) {
  const nine = [];
  for (const d of ["transport", "job", "money"]) for (let i = 0; i < 3; i++) nine.push([(s[d] || [])[i] || "", d]);
  const p3 = [0, 1, 2].map(i => (s.other || [])[i] || "");
  const ed = runParse(nine, p3);
  let raw = "", status = ed.exp2a_llm_status;
  if (ed.exp2a_needs_llm === "1") {
    const rows = ed.exp2a_residue.split(" ||| ");
    const out = llm ? llm(rows) : [];
    raw = typeof out === "string" ? out : JSON.stringify(out);
    status = "message";
  }
  const r = await runRender(ed, raw, status, opts);
  ALL_TEXTS.push(["scenario " + JSON.stringify(s), ed.exp2a_text || ""]);
  return ed;
}

const En = (text, name, rel, category, usable = true) => ({ text, name, relationship: rel, category, usable });
const strip = r => r.replace(/^\w+:\s*/, "");
const primed = ed => [1, 2, 3].map(k => ed["exp2a_name" + k]).filter(Boolean);

let nBad = 0, nRun = 0;
const tests = [];
function T(label, fn) { tests.push([label, fn]); }

// ---- Fix 1: spouse names are excluded everywhere ---------------------------------------------------------------------
T("1. wife Kate / Kate / Kate best friend / Ann -> generic, no Kate", async () => {
  const ed = await scenario({ transport: ["my wife Kate"], job: ["Kate"], money: ["Kate, my best friend"], other: ["Ann"] });
  assert.deepStrictEqual(primed(ed), []);
  assert.strictEqual(ed.exp2a_variant, "generic");
  assert.ok(!/Kate/.test(ed.exp2a_text));
});
T("1. husband Joe / Joe / Sara -> generic, no Joe", async () => {
  const ed = await scenario({ transport: ["my husband Joe"], job: ["Joe"], money: ["Sara"] });
  assert.deepStrictEqual(primed(ed), []);
  assert.strictEqual(ed.exp2a_variant, "generic");
});
T("1. spouse excluded but others remain (Kate cross-domain would have ranked first)", async () => {
  const ed = await scenario({ transport: ["my wife Kate", "Ann"], job: ["Kate", "Bo"], money: ["Kate, my best friend", "Cy"] });
  assert.deepStrictEqual(primed(ed), ["Ann", "Bo", "Cy"]);
});
T("1. spouse name case-insensitive", async () => {
  const ed = await scenario({ transport: ["my wife Kate", "Ann", "Bo"], job: ["kate"], money: ["KATE (friend)"] });
  assert.deepStrictEqual(primed(ed), ["Ann", "Bo"]);
});
T("1. LLM-resolved spouse (usable=false, category spouse_partner) excludes the name elsewhere", async () => {
  const ed = await scenario({ transport: ["my husband Joe", "Joe (hubby)"], job: ["partner", "Joe"], money: ["Joe my love", "Sara"] },
    rows => rows.map(r => En(strip(r), "Joe", "husband", "spouse_partner", false)));
  assert.deepStrictEqual(primed(ed), []);
  assert.strictEqual(ed.exp2a_variant, "generic");
});
T("1. LLM relationship resolves to spouse with benign category: name excluded from det pairs too", async () => {
  const ed = await scenario({ transport: ["Joe my rock", "Sara"], job: ["Tim", "Joe"] },
    rows => [En(strip(rows[0]), "Joe", "my hubby", "other")]);
  assert.deepStrictEqual(primed(ed), ["Sara", "Tim"]);
});
T("1. work / business / lab partner are not spouse", () => {
  for (const t of ["work partner", "business partner", "lab partner", "my work partner", "Dan, work partner", "my business partner Lou", "Lou (lab partner)"]) {
    assert.notStrictEqual(E.classifyEntry(t).cls, "spouse", t);
  }
  const r = E.classifyEntry("Dan, work partner");
  assert.strictEqual(r.name, "Dan"); assert.strictEqual(r.rel, "work partner");
  for (const t of ["partner", "my partner", "Tom, partner", "life partner"]) { assert.strictEqual(E.classifyEntry(t).cls, "spouse", t); }
});
T("1. current wordlist behaviour pinned (boyfriend/girlfriend/fiance/bf/gf spouse; my love/bae residue)", () => {
  for (const t of ["boyfriend", "girlfriend", "my boyfriend Tom", "Tom, boyfriend", "fiance", "fiancé", "fiancée", "fiancee", "Tom (fiancé)", "my bf", "gf"]) {
    assert.strictEqual(E.classifyEntry(t).cls, "spouse", t);
  }
  for (const t of ["my love", "Joe my love", "bae", "Joe my bae", "Joe, bae"]) { assert.strictEqual(E.classifyEntry(t).cls, "residue", t); }
});
T("1. classifyEntry carries the spouse's name", () => {
  const cases = [["my husband Joe", "Joe"], ["Joe (hubby)", "Joe"], ["Sarah — my wife", "Sarah"], ["Tom, boyfriend", "Tom"], ["my wife", null]];
  for (const [t, n] of cases) { const r = E.classifyEntry(t); assert.strictEqual(r.cls, "spouse", t); assert.strictEqual(r.spouseName || null, n, t); }
});

// ---- Fix 2: residue matching ------------------------------------------------------------------------------------------
const ROWS_PAM_RICK = [{ text: "the lady next door Pam", domain: "transport", index: 0 }, { text: "Rick, he coaches my kid", domain: "money", index: 6 }];
T("2. reorder + altered text (Pam/Rick/Dee/Eve/Flo): primed Pam, Dee, Eve, not Rick", async () => {
  const S = { transport: ["the lady next door Pam", "Pam"], job: ["Dee (sister)", "Eve (aunt)", "Flo (cousin)"], money: ["Rick, he coaches my kid"] };
  const ed = await scenario(S, () => [En("Rick - he coaches my kid", "Rick", "coach", "other"), En("The lady next door, Pam", "Pam", "neighbor", "neighbor")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Dee", "Eve"]);
});
T("2. exact echo of the same input (control)", async () => {
  const S = { transport: ["the lady next door Pam", "Pam"], job: ["Dee (sister)", "Eve (aunt)", "Flo (cousin)"], money: ["Rick, he coaches my kid"] };
  const ed = await scenario(S, () => [En("the lady next door Pam", "Pam", "neighbor", "neighbor"), En("Rick, he coaches my kid", "Rick", "coach", "other")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Dee", "Eve"]);
});
T("2. mergeLlm: names land on the right row (domain/index), no positional fill", () => {
  const llm = JSON.stringify([En("Rick - he coaches my kid", "Rick", "coach", "other"), En("The lady next door, Pam", "Pam", "neighbor", "neighbor")]);
  const out = E.mergeLlm([], llm, ROWS_PAM_RICK);
  const by = {}; out.forEach(p => { by[p.name] = p; });
  assert.deepStrictEqual(by.Rick.domains, ["money"]); assert.strictEqual(by.Rick.firstIndex, 6);
  assert.deepStrictEqual(by.Pam.domains, ["transport"]); assert.strictEqual(by.Pam.firstIndex, 0);
});
T("2. altered text with a comma: Pam matches", async () => {
  const ed = await scenario({ transport: ["the lady next door Pam", "Ann"], job: ["my old roomie Sal"], money: ["coach Rick from little league!"] },
    () => [En("The lady next door, Pam", "Pam", "neighbor", "neighbor"), En("my  old roomie sal", "Sal", "roommate", "friend"),
           En("coach rick from little league", "Rick", "coach", "other"), En("extra", "X", "friend", "friend")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Sal", "Rick"]);
});
T("2. partial echo (P2): altered Rick and Sal still matched by name", async () => {
  const ed = await scenario({ transport: ["the lady next door Pam"], job: ["my old roomie Sal"], money: ["coach Rick from little league"], other: ["Ann"] },
    () => [En("Coach Rick, from little league", "Rick", "coach", "other"), En("the lady next door Pam", "Pam", "neighbor", "neighbor"), En("my old roomie, Sal", "Sal", "roommate", "friend")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Sal", "Rick"]);
});
T("2. my neighbors Bob and Sue -> both Bob and Sue from one row", async () => {
  const ed = await scenario({ money: ["my neighbors Bob and Sue"], transport: ["Ann"] },
    rows => rows.map(r => { const t = strip(r); return [En(t, "Bob", "neighbor", "neighbor"), En(t, "Sue", "neighbor", "neighbor")]; }).flat());
  assert.deepStrictEqual(primed(ed).sort(), ["Ann", "Bob", "Sue"]);
  const rows = [{ text: "my neighbors Bob and Sue", domain: "money", index: 6 }];
  const out = E.mergeLlm([], JSON.stringify([En("my neighbors Bob and Sue", "Bob", "neighbor", "x"), En("my neighbors Bob and Sue", "Sue", "neighbor", "x"), En("my neighbors Bob and Sue", "Bob", "neighbor", "x")]), rows);
  assert.deepStrictEqual(out.map(p => p.name).sort(), ["Bob", "Sue"], "the same name cannot match one row twice");
});
T("2. exact reorder still correct", async () => {
  const ed = await scenario({ transport: ["the lady next door Pam", "Ann"], job: ["my old roomie Sal"], money: ["coach Rick from little league"] },
    rows => [En(strip(rows[2]), "Rick", "coach", "other"), En(strip(rows[0]), "Pam", "neighbor", "neighbor"), En(strip(rows[1]), "Sal", "roommate", "friend")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Sal", "Rick"]);
});
T("2. invented entries dropped (extra Bob; entry without text/name match)", async () => {
  const ed = await scenario({ transport: ["the lady next door Pam"], job: ["my old roomie Sal"] },
    rows => [En(strip(rows[0]), "Pam", "neighbor", "neighbor"), En(strip(rows[1]), "Sal", "roommate", "friend"), En("Bob", "Bob", "friend", "friend")]);
  assert.deepStrictEqual(primed(ed), ["Pam", "Sal"]);
  const ed2 = await scenario({ transport: ["xyz thing 1", "Ann"] }, () => ({ entries: [{ name: "Carl", relationship: "friend", category: "friend", usable: true }] }));
  assert.ok(primed(ed2).indexOf("Carl") === -1, "no position fallback for a text-less entry");
});
T("2. identical text in two domains maps to two distinct rows", () => {
  const rows = [{ text: "my buddy from the gym Carl", domain: "transport", index: 2 }, { text: "my buddy from the gym Carl", domain: "money", index: 7 }];
  const llm = JSON.stringify([En(rows[0].text, "Carl", "friend", "friend"), En(rows[1].text, "Carl", "friend", "friend")]);
  const out = E.mergeLlm([], llm, rows);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].domains.slice().sort(), ["money", "transport"]);
});

// ---- Fix 3: exact slot index ------------------------------------------------------------------------------------------
T("3. exp2a_residue_slots written by the parse hook, absolute 0-11", async () => {
  const ed = runParse([["Ann", "transport"], ["", "transport"], ["the one who helps", "transport"], ["", "job"], ["", "job"], ["my ride or die", "job"],
    ["", "money"], ["my pal from the gym", "money"], ["", "money"]], ["", "", ""]);
  assert.strictEqual(ed.exp2a_residue_slots, "2,5,7");
  assert.strictEqual(runParse([["Ann", "transport"]], ["", "", ""]).exp2a_residue_slots, "");
});
T("3. same-domain residue after det pairs: primed Dee, Ann, Ben", async () => {
  const ed = await scenario({ transport: ["Ann", "Ben", "my buddy Carl from the gym"], job: ["Dee (sister)"] }, rows => rows.map(r => En(strip(r), "Carl", null, "friend")));
  assert.strictEqual(ed.exp2a_residue_slots, "2");
  assert.deepStrictEqual(primed(ed), ["Dee", "Ann", "Ben"]);
});
T("3. parseResidueString: exact with slots, approximate fallback when absent or inconsistent", () => {
  const str = "transport: a b c ||| job: d e f ||| money: g h i";
  assert.deepStrictEqual(E.parseResidueString(str, "2,5,7").map(r => r.index), [2, 5, 7]);
  assert.deepStrictEqual(E.parseResidueString(str, "").map(r => r.index), [0, 3, 6]);
  assert.deepStrictEqual(E.parseResidueString(str, "2,5").map(r => r.index), [0, 3, 6]);
  assert.deepStrictEqual(E.parseResidueString(str, "2,5,x").map(r => r.index), [0, 3, 6]);
});
T("3. a respondent entry containing the row separator cannot desynchronise rows from slots", async () => {
  const ed = runParse([["Bob ||| money: Fake Guy", "transport"], ["Ann", "transport"], ["", "transport"]], ["", "", ""]);
  assert.strictEqual(ed.exp2a_residue.split(" ||| ").length, ed.exp2a_residue_slots.split(",").filter(Boolean).length);
});

// ---- Fix 4: sanitise LLM output ----------------------------------------------------------------------------------------
const BAD_TOKENS = [/\bnull\b/, /N\/A/, /undefined/, /\[object/, /your your/, /\btrue\b/, /\(\s*\)/, /[ \t]{2,}/];
function checkStimulus(label, text) {
  for (const re of BAD_TOKENS) { assert.ok(!re.test(text), `${label}: stimulus matches ${re}: ${text.slice(0, 200)}`); }
  assert.ok(!/\[[A-Z_0-9]+\]/.test(text), `${label}: unfilled token`);
}
T("4. name null / N/A rejected; relationship 'null' rejected", async () => {
  const ed = await scenario({ transport: ["the guy at work", "that one lady"], job: ["Ann"] },
    rows => [En(strip(rows[0]), "null", "coworker", "coworker"), En(strip(rows[1]), "N/A", "null", "other")]);
  assert.deepStrictEqual(primed(ed), ["Ann", "your coworker"]);
  checkStimulus("R3", ed.exp2a_text);
});
T("4. non-string name/relationship ({} true [..] 5) treated as absent", async () => {
  const ed = await scenario({ transport: ["xyz thing 1", "xyz thing 2", "xyz thing 3"] },
    rows => [En(strip(rows[0]), ["Bob"], 5, "friend"), En(strip(rows[1]), { a: 1 }, null, "friend"), En(strip(rows[2]), true, "", "friend")]);
  assert.deepStrictEqual(primed(ed), []);
  checkStimulus("R6", ed.exp2a_text);
  const out = E.mergeLlm([], JSON.stringify([En("xyz", "Bob", 5, "friend")]), [{ text: "xyz", domain: "job", index: 3 }]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].name, "Bob"); assert.strictEqual(out[0].rel, null);
});
T("4. relationship 'your best friend' -> 'best friend' (no 'your your')", async () => {
  const ed = await scenario({ transport: ["the one who always helps", "Ann"], job: ["Bo"] }, rows => [En(strip(rows[0]), null, "your best friend", "friend")]);
  assert.deepStrictEqual(primed(ed), ["Ann", "Bo", "your best friend"]);
  assert.strictEqual(ed.exp2a_rel3, "best friend");
  checkStimulus("K", ed.exp2a_text);
});
T("4. name cleanup: capitalise, strip emoji/markup, length, rel words", () => {
  const rows = [{ text: "xyz", domain: "job", index: 3 }];
  const one = (name, rel) => E.mergeLlm([], JSON.stringify([En("xyz", name, rel, "friend")]), rows);
  assert.strictEqual(one("kevin", "neighbor")[0].name, "Kevin");
  assert.strictEqual(one("Bob😀", null)[0].name, "Bob");
  assert.strictEqual(one("Ann-Marie O'Neil", null)[0].name, "Ann-Marie");
  assert.strictEqual(one("José", null)[0].name, "José");
  for (const bad of ["null", "None", "N/A", "n/a", "NA", "unknown", "undefined", "nobody", "no one", "me", "myself", "A".repeat(21), "😀", "", "Mom", "father", "Wife", "<img src=x>", "&lt;img&gt;"]) {
    assert.strictEqual(one(bad, null).length, 0, "name " + JSON.stringify(bad) + " must be rejected");
  }
  assert.strictEqual(one("A".repeat(20), null)[0].name.length, 20);
  assert.strictEqual(one("Mom", "mother")[0].name, null); assert.strictEqual(one("Mom", "mother")[0].rel, "mother");
  assert.strictEqual(one("Bob", "my neighbor")[0].rel, "neighbor");
  assert.strictEqual(one("Bob", "OUR dear friend")[0].rel, "dear friend");
  for (const bad of ["null", "none", "n/a", "unknown", "x".repeat(31), 7, {}, true]) { assert.strictEqual(one("Bob", bad)[0].rel, null, "rel " + JSON.stringify(bad)); }
});
T("4. long / emoji / markup LLM output (R4)", async () => {
  const ed = await scenario({ transport: ["xyz thing 1", "xyz thing 2", "xyz thing 3"] },
    rows => [En(strip(rows[0]), "A".repeat(300), null, "friend"), En(strip(rows[1]), "Bob😀", null, "friend"),
      En(strip(rows[2]), "&lt;img src=x onerror=alert(1)&gt;", "&lt;b&gt;friend&lt;/b&gt; &amp; co", "friend")]);
  assert.ok(!/AAAAAAAAAAAAAAAAAAAAA/.test(ed.exp2a_text || ""));
  assert.ok(!/[<>&]|😀/.test((ed.exp2a_name1 || "") + (ed.exp2a_rel1 || "") + (ed.exp2a_text || "")));
  checkStimulus("R4", ed.exp2a_text);
});
T("4. LLM name that is a relationship word (R7): rel kept, name dropped", async () => {
  const ed = await scenario({ transport: ["my momma bear", "pops", "Ann"] }, rows => [En(strip(rows[0]), "Mom", "mother", "family"), En(strip(rows[1]), null, "dad", "family")]);
  assert.deepStrictEqual(primed(ed), ["Ann", "your mother", "your dad"]);
});

// ---- Fix 5: relationship-only pairs do not merge ------------------------------------------------------------------------
T("5. dedupePairs: two rel-only 'friend' pairs stay separate; same name merges", () => {
  const out = E.dedupePairs([
    { name: null, rel: "friend", cls: "rel_only", domains: ["transport"], firstIndex: 0 },
    { name: null, rel: "friend", cls: "rel_only", domains: ["money"], firstIndex: 6 },
    { name: "Ann", rel: null, cls: "name_only", domains: ["job"], firstIndex: 3 },
    { name: "ann", rel: "sister", cls: "named_rel", domains: ["other"], firstIndex: 9 }]);
  assert.strictEqual(out.length, 3);
  assert.ok(out.filter(p => !p.name).every(p => p.domains.length === 1));
  assert.deepStrictEqual(out.filter(p => p.name)[0].domains, ["job", "other"]);
});
T("5. 'my friend' in two domains: two pairs, not a cross-domain person", async () => {
  const ed = await scenario({ transport: ["my friend", "Ann"], money: ["my friend", "Bea"], job: ["Cy"] });
  assert.strictEqual(ed.exp2a_n_names, "5");
  assert.deepStrictEqual(primed(ed), ["Ann", "Cy", "Bea"]);
});

// ---- Fix 6: analyst reconstruction field --------------------------------------------------------------------------------
T("6. exp2a_selected_json: fields, origin and match", async () => {
  const S = { transport: ["the lady next door Pam", "Pam"], job: ["Dee (sister)", "Eve (aunt)", "Flo (cousin)"], money: ["Rick, he coaches my kid"] };
  const ed = await scenario(S, () => [En("Rick - he coaches my kid", "Rick", "coach", "other"), En("The lady next door, Pam", "Pam", "neighbor", "neighbor")]);
  const sel = JSON.parse(ed.exp2a_selected_json);
  assert.deepStrictEqual(sel.map(p => p.name), ["Pam", "Dee", "Eve"]);
  for (const p of sel) { assert.deepStrictEqual(Object.keys(p).sort(), ["domains", "firstIndex", "match", "name", "origin", "rel"]); }
  assert.strictEqual(sel[1].origin, "det"); assert.strictEqual(sel[1].match, null);
  // Pam: det "Pam" (transport slot 1) merged with the LLM "Pam" (name match to slot 0); det wins origin, first index 0
  assert.deepStrictEqual(sel[0].domains, ["transport"]); assert.strictEqual(sel[0].firstIndex, 0);
  const ed2 = await scenario({ transport: ["the lady next door Pam"], job: ["Ann"], money: ["Bo"] }, rows => [En(strip(rows[0]), "Pam", "neighbor", "neighbor")]);
  const s2 = JSON.parse(ed2.exp2a_selected_json);
  const pam = s2.find(p => p.name === "Pam");
  assert.strictEqual(pam.origin, "llm"); assert.strictEqual(pam.match, "exact");
  const ed3 = await scenario({ transport: ["the lady next door Pam"], job: ["Ann"], money: ["Bo"] }, rows => [En("Pam, a neighbor", "Pam", "neighbor", "neighbor")]);
  assert.strictEqual(JSON.parse(ed3.exp2a_selected_json).find(p => p.name === "Pam").match, "name");
  const ed4 = await scenario({ transport: ["Ann"], job: ["Bo"] });
  assert.strictEqual(ed4.exp2a_variant, "named2");
  assert.deepStrictEqual(JSON.parse(ed4.exp2a_selected_json).map(p => p.name), ["Ann", "Bo"]);
});
T("6. exp2a_selected_json is [] for generic", async () => {
  const ed = await scenario({ transport: ["Ann"] });
  assert.strictEqual(ed.exp2a_selected_json, "[]");
});

// ---- stimulus-text invariant -------------------------------------------------------------------------------------------
const GENERIC_LLM = rows => rows.map(r => {
  const t = strip(r), m = t.match(/\p{Lu}\p{L}+/u);
  return En(t, m ? m[0] : null, "friend", "other");
});
const HOSTILE_LLM = rows => rows.map((r, i) => {
  const t = strip(r);
  return [En(t, "null", "null", "other"), En(t, "N/A", "your my best friend", "other"), En(t, { x: 1 }, 5, "other"), En(t, true, false, "other"),
    En(t, "undefined", "undefined", "other"), En(t, "😀", "😀", "other"), En(t, ["Bob"], ["friend"], "other")][i % 7];
});
T("INVARIANT: no null / N/A / undefined / [object / your your / true / '( )' / doubled spaces in any stimulus", async () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.json"), "utf8"));
  for (const c of corpus.entries) {
    for (const llm of [GENERIC_LLM, HOSTILE_LLM]) {
      const ed = await scenario({ transport: [c.text], job: ["Ann", "Bo"], money: ["Cy"] }, llm);
      checkStimulus("corpus " + JSON.stringify(c.text), ed.exp2a_text);
    }
  }
  const resp = JSON.parse(fs.readFileSync(path.join(__dirname, "respondents.json"), "utf8"));
  for (const r of resp.respondents) {
    for (const llm of [GENERIC_LLM, HOSTILE_LLM]) {
      const nine = [], p3 = [];
      r.slots.forEach((t, i) => { if (i < 9) nine.push([t, E.DOMAINS[Math.floor(i / 3)]]); else p3.push(t); });
      const ed = runParse(nine, p3);
      let raw = "", status = ed.exp2a_llm_status;
      if (ed.exp2a_needs_llm === "1") { raw = JSON.stringify(llm(ed.exp2a_residue.split(" ||| "))); status = "message"; }
      await runRender(ed, raw, status);
      checkStimulus("respondent " + r.label, ed.exp2a_text);
    }
  }
  // every stimulus any test in this file produced (reviewer cases included), re-checked at the end
});

(async () => {
  for (const [label, fn] of tests) {
    nRun++;
    try { await fn(); console.log("ok    " + label); }
    catch (e) { nBad++; console.error("FAIL  " + label + "\n        " + String(e && e.message).split("\n").slice(0, 3).join("\n        ")); }
  }
  // the invariant over every stimulus produced above
  let nTexts = 0;
  for (const [label, text] of ALL_TEXTS) {
    if (!text) { continue; }
    nTexts++;
    try { checkStimulus(label, text); } catch (e) { nBad++; console.error("FAIL  invariant on " + label + "\n        " + String(e.message).split("\n")[0]); }
  }
  console.log(`checked ${nTexts} stimuli from ${ALL_TEXTS.length} scenario runs`);
  console.log(nBad ? `test-review: ${nBad} FAILED of ${nRun}` : `test-review: all ${nRun} pass`);
  process.exit(nBad ? 1 : 0);
})();
