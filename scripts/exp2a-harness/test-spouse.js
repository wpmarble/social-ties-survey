// Dev tool — Phase 2f: deterministic spouse-exclusion safety net, name provenance, stimulus hygiene.
// Drives the BUILT bundles (exp2a-parse.js, exp2a-render.js) through parse -> simulated LLM -> render in node vm
// (cases ported from the reviewer's spouse.js). Run: node test-spouse.js (after exp2a-build.js).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const E = require("../exp2a-core.js");

const SCRIPTS = path.join(__dirname, "..");
const PARSE = fs.readFileSync(path.join(SCRIPTS, "exp2a-parse.js"), "utf8");
const RENDER = fs.readFileSync(path.join(SCRIPTS, "exp2a-render.js"), "utf8");
const FLAG_LINE = "var EXCLUDE_ENDEARMENTS = false;";
const PARSE_ENDEAR = PARSE.replace(FLAG_LINE, "var EXCLUDE_ENDEARMENTS = true;");
const RENDER_ENDEAR = RENDER.replace(FLAG_LINE, "var EXCLUDE_ENDEARMENTS = true;");
assert.ok(PARSE.indexOf(FLAG_LINE) !== -1 && PARSE_ENDEAR !== PARSE && RENDER_ENDEAR !== RENDER, "EXCLUDE_ENDEARMENTS flag line not found");
const TPL = {};
for (const f of ["tie-named-3", "tie-named-2", "tie-generic", "placebo"]) {
  TPL[f + ".txt"] = fs.readFileSync(path.join(SCRIPTS, "..", "exp2a", "templates", f + ".txt"), "utf8");
}

// Qualtrics pipes raw ED into HTML and the hooks read textContent: decode entities once.
function htmlDecode(s) {
  return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
}

function runParse(slots9, page3, bundle) {
  const ed = {};
  const load = [], sub = [];
  const ctx = {
    console: { log() {}, error() {} },
    Qualtrics: { SurveyEngine: { addOnload: f => load.push(f), addOnPageSubmit: f => sub.push(f), setEmbeddedData: (k, v) => { ed[k] = String(v); } } },
    document: { getElementById: id => id === "exp2aPrior" ? { querySelectorAll: () => slots9.map(([t, d]) => ({ textContent: htmlDecode(t), getAttribute: () => d })) } : null },
    JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(bundle || PARSE, ctx);
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
  vm.runInContext((opts.renderBundle || RENDER).split("${e://Field/exp2a_arm}").join("tie").split("${e://Field/resp_id}").join("R_x"), ctx);
  load.forEach(f => f.call({ getQuestionContainer: () => null }));
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return { ed, html: disp.innerHTML };
}


const En = (text, name, rel, category, usable = true) => ({ text, name, relationship: rel, category, usable });
const strip = r => r.replace(/^\w+:\s*/, "");
const primed = ed => [1, 2, 3].map(k => ed["exp2a_name" + k]).filter(Boolean);
const TEXTS = [];

// s: {transport,job,money,other}; llm: rows -> entries | raw string; failed: LLM call failed (status empty)
async function sc(s, llm, o) {
  o = o || {};
  const nine = [];
  for (const d of ["transport", "job", "money"]) for (let i = 0; i < 3; i++) nine.push([(s[d] || [])[i] || "", d]);
  const p3 = [0, 1, 2].map(i => (s.other || [])[i] || "");
  const ed = runParse(nine, p3, o.endear ? PARSE_ENDEAR : PARSE);
  let raw = "", st = ed.exp2a_llm_status;
  if (ed.exp2a_needs_llm === "1") {
    if (o.failed) { st = ""; }
    else { const out = llm ? llm(ed.exp2a_residue.split(" ||| ")) : []; raw = typeof out === "string" ? out : JSON.stringify(out); st = "message"; }
  }
  await runRender(ed, raw, st, { renderBundle: o.endear ? RENDER_ENDEAR : RENDER });
  TEXTS.push(ed.exp2a_text || "");
  return ed;
}

const tests = [];
const T = (label, fn) => tests.push([label, fn]);
const EXTRA = { other: ["Ann", "Bo"] };
const mk = (a, b, extra) => Object.assign({ transport: [a], job: [b] }, extra === false ? {} : EXTRA);

// Spouse entry + the same name elsewhere: the spouse is excluded everywhere. Alone -> generic; with Ann, Bo -> exactly [Ann, Bo].
function spouseCase(label, a, b, o, llm) {
  T(label + " -> generic", async () => {
    const ed = await sc(mk(a, b, false), llm, o);
    assert.deepStrictEqual(primed(ed), [], JSON.stringify(primed(ed)));
    assert.strictEqual(ed.exp2a_variant, "generic");
  });
  T(label + " -> others only", async () => {
    const ed = await sc(mk(a, b), llm, o);
    assert.deepStrictEqual(primed(ed), ["Ann", "Bo"], JSON.stringify(primed(ed)));
  });
}
spouseCase("Wife Kate + Kate", "Wife Kate", "Kate");
spouseCase("Husband John + John", "Husband John", "John");
spouseCase("GF Kate + Kate", "GF Kate", "Kate");
spouseCase("Partner Sam + Sam", "Partner Sam", "Sam");
spouseCase("Hubby Tom + Tom", "Hubby Tom", "Tom");
spouseCase("Kate Wife + Kate", "Kate Wife", "Kate");
spouseCase("kate, my wife + Kate (LLM failed)", "kate, my wife", "Kate", { failed: true });
spouseCase("my wife Kate Smith + Kate (LLM failed)", "my wife Kate Smith", "Kate", { failed: true });
spouseCase("the wife Kate + Kate (LLM failed)", "the wife Kate", "Kate", { failed: true });
spouseCase("Kate my wife of 20 years + Kate (LLM failed)", "Kate my wife of 20 years", "Kate", { failed: true });
spouseCase("Kate-Lynn, my wife + Kate-Lynn (LLM failed)", "Kate-Lynn, my wife", "Kate-Lynn", { failed: true });
spouseCase("my husband José + Jose", "my husband José", "Jose");
spouseCase("my husband Jose + José", "my husband Jose", "José");
spouseCase("NFD my husband José + NFC José", "my husband Jose\u0301", "Jos\u00e9");
spouseCase("NFC my husband José + NFD José", "my husband Jos\u00e9", "Jose\u0301");
spouseCase("Kate, my wife's sister + Kate (over-exclusion accepted)", "Kate, my wife's sister", "Kate");
spouseCase("KATE, my wife + kate", "KATE, my wife", "kate");

T("LLM spouse_partner entry with paraphrased text matching no row -> name excluded everywhere", async () => {
  const s = { transport: ["the missus K8 lol"], job: ["Kate"], money: ["Bob, my brother"], other: ["Ann"] };
  const ed = await sc(s, rows => rows.map(r => /K8/.test(r) ? En("the missus Kate", "Kate", "wife", "spouse_partner", false) : En(strip(r), null, null, "unusable", false)));
  assert.deepStrictEqual(primed(ed), ["Bob", "Ann"]);
});
T("LLM relationship resolving to spouse (benign category, paraphrased text) excludes the name", async () => {
  const s = { transport: ["the missus K8 lol"], job: ["Kate"], money: ["Bob, my brother"], other: ["Ann"] };
  const ed = await sc(s, () => [En("something else entirely", "Kate", "my hubby", "other", true)]);
  assert.deepStrictEqual(primed(ed), ["Bob", "Ann"]);
});
T("LLM name not in its row ('the guy at the store' / Steve) is dropped, even on exact text", async () => {
  const ed = await sc({ transport: ["the guy at the store"], other: ["Ann", "Bo"] }, rows => rows.map(r => En(strip(r), "Steve", "friend", "friend")));
  assert.deepStrictEqual(primed(ed), ["Ann", "Bo"]);
  assert.ok(!/Steve/.test(ed.exp2a_text) && !/Steve/.test(ed.exp2a_selected_json));
  const out = E.mergeLlm([], JSON.stringify([En("the guy at the store", "Steve", "friend", "friend")]), [{ text: "the guy at the store", domain: "job", index: 3 }]);
  assert.strictEqual(out.length, 0);
  const ok = E.mergeLlm([], JSON.stringify([En("the guy at the store Steve", "steve", "friend", "friend")]), [{ text: "the guy at the store Steve", domain: "job", index: 3 }]);
  assert.strictEqual(ok.length, 1);
});
T("provenance is diacritic-insensitive (José in row, Jose from the LLM)", () => {
  const out = E.mergeLlm([], JSON.stringify([En("the guy José from work", "Jose", "coworker", "coworker")]), [{ text: "the guy José from work", domain: "job", index: 3 }]);
  assert.strictEqual(out.length, 1);
});
T("'Mom Linda' -> named_rel Linda (mother), never name Mom", async () => {
  const ed = await sc({ transport: ["Mom Linda"], other: ["Ann"] });
  assert.deepStrictEqual(primed(ed), ["Linda", "Ann"]);
  assert.strictEqual(ed.exp2a_rel1, "mom");
  for (const t of ["Mom Linda", "mom Linda", "Aunt Jo", "Wife Kate", "Mom", "Husband John"]) {
    const r = E.classifyEntry(t);
    assert.ok(!/^(mom|aunt|wife|husband)$/i.test(r.name || ""), t + " -> " + JSON.stringify(r));
  }
});
T("names Null / Undefined / True / NaN / None never appear (respondent-typed)", async () => {
  const ed = await sc({ transport: ["Null", "Undefined", "True"], job: ["NaN", "False", "None Smith"], other: ["Ann", "Bo"] });
  assert.deepStrictEqual(primed(ed), ["Ann", "Bo"]);
});
T("LLM names Null / True / Undefined rejected case-insensitively", async () => {
  const ed = await sc({ transport: ["that guy True", "that guy NULL", "that guy Undefined"], other: ["Ann", "Bo"] },
    rows => rows.map(r => En(strip(r), strip(r).split(" ").pop(), "friend", "friend")));
  assert.ok(primed(ed).indexOf("True") === -1 && primed(ed).indexOf("NULL") === -1 && primed(ed).indexOf("Undefined") === -1, JSON.stringify(primed(ed)));
  for (const n of ["True", "TRUE", "Null", "UNDEFINED", "NaN", "False", "None", "N/A", "Unknown"]) { assert.strictEqual(E.cleanLlmName(n), null, n); }
});
T("LLM relationships 'true' / 'a' / 'the your friend' cannot reach the stimulus", async () => {
  const ed = await sc({ transport: ["that tall guy Bob", "that tall lady Cy", "that short guy Di"] }, rows => [
    En(strip(rows[0]), "Bob", "true", "friend"), En(strip(rows[1]), "Cy", "a", "friend"), En(strip(rows[2]), "Di", "the your friend", "friend")]);
  assert.deepStrictEqual(primed(ed).sort(), ["Bob", "Cy", "Di"]);
  assert.deepStrictEqual([1, 2, 3].map(k => ed["exp2a_rel" + k]).sort(), ["", "", "friend"]);
  assert.ok(!/\(your (the|a|true)/i.test(ed.exp2a_text), ed.exp2a_text);
  for (const [v, want] of [["true", null], ["True", null], ["a", null], ["an", null], ["the", null], ["The", null], ["the your friend", "friend"], ["a friend", "friend"], ["the", null], ["your the your friend", "friend"], ["an old friend", "old friend"]]) {
    assert.strictEqual(E.cleanLlmRel(v), want, v);
  }
});

// ---- endearments: flag false (current) vs true ---------------------------------------------------------------------------
T("ENDEARMENT_TERMS constant and flag default", () => {
  assert.deepStrictEqual(E.ENDEARMENT_TERMS, ["love", "bae", "sweetheart", "sweetie", "honey", "babe", "darling", "sweetpea"]);
  assert.ok(PARSE.indexOf(FLAG_LINE) !== -1, "EXCLUDE_ENDEARMENTS ships false");
});
for (const w of ["my love", "bae", "sweetheart", "sweetie", "honey", "babe", "darling", "sweetpea"]) {
  const a = w === "my love" ? "Joe my love" : "Joe " + w;
  T("endearments TRUE: '" + a + "' excludes Joe", async () => {
    const ed = await sc({ transport: [a], job: ["Joe"], other: ["Ann", "Bo"] }, rows => rows.map(r => En(strip(r), "Joe", null, "other")), { endear: true });
    assert.deepStrictEqual(primed(ed), ["Ann", "Bo"]);
    assert.strictEqual(ed.exp2a_needs_llm, "0", "decided without the LLM");
  });
  T("endearments FALSE: '" + a + "' behaves as before (goes to the LLM, Joe not excluded by the scan)", async () => {
    const ed = await sc({ transport: [a], job: ["Joe"], other: ["Ann", "Bo"] }, rows => rows.map(r => En(strip(r), "Joe", null, "other")));
    assert.strictEqual(ed.exp2a_needs_llm, "1");
    assert.ok(primed(ed).indexOf("Joe") !== -1, JSON.stringify(primed(ed)));
  });
}
T("endearment words are not name candidates ('Joe my love' with TRUE excludes only Joe)", () => {
  assert.deepStrictEqual(E.scanSpouse("Joe my love").spouse, false);
  const src = fs.readFileSync(path.join(SCRIPTS, "exp2a-core.js"), "utf8").replace(FLAG_LINE, "var EXCLUDE_ENDEARMENTS = true;");
  const ctx = { module: { exports: {} } }; vm.createContext(ctx); vm.runInContext(src, ctx);
  const X = ctx.module.exports;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(X.scanSpouse("Joe my love"))), { spouse: true, names: ["joe"] });
});

// ---- name keys ------------------------------------------------------------------------------------------------------------
T("nameKey folds case and diacritics (NFC, NFD, ASCII all equal), with and without String.prototype.normalize", () => {
  const k = E.nameKey("Jose");
  for (const v of ["José", "Jose\u0301", "JOSÉ", "jose", "Jos\u00e9"]) { assert.strictEqual(E.nameKey(v), k, JSON.stringify(v)); }
  assert.strictEqual(E.nameKey("Kate-Lynn"), "katelynn");
  const src = fs.readFileSync(path.join(SCRIPTS, "exp2a-core.js"), "utf8");
  const ctx = { module: { exports: {} } }; vm.createContext(ctx);
  vm.runInContext("delete String.prototype.normalize;", ctx);
  vm.runInContext(src, ctx);
  const X = ctx.module.exports;
  assert.strictEqual(X.nameKey("JOSE"), "jose");
  assert.strictEqual(X.nameKey("Kate-Lynn"), "katelynn");
});

// ---- regressions ----------------------------------------------------------------------------------------------------------
T("regression: work / business / lab partner are not spouse; scan exempts them and 'partner in crime'", async () => {
  for (const t of ["work partner", "business partner", "lab partner", "my work partner", "Dan, work partner", "my business partner Lou", "Lou (lab partner)", "Sam, partner in crime"]) {
    assert.strictEqual(E.scanSpouse(t).spouse, false, t);
  }
  for (const t of ["partner", "Partner Sam", "my partner Kate", "Tom, partner", "life partner", "Kate, girlfriend", "BF", "my fiancé Kate", "wife's", "Wifey"]) {
    assert.strictEqual(E.scanSpouse(t).spouse, true, t);
  }
  const ed = await sc({ transport: ["Dan, work partner"], job: ["Dan"], other: ["Ann"] });
  assert.ok(primed(ed).indexOf("Dan") !== -1 && ed.exp2a_rel1 === "work partner", JSON.stringify(primed(ed)));
});
T("regression: my neighbors Bob and Sue still yields both; honorifics and plain names intact", async () => {
  const ed = await sc({ money: ["my neighbors Bob and Sue"], transport: ["Ann"] },
    rows => rows.map(r => { const t = strip(r); return [En(t, "Bob", "neighbor", "neighbor"), En(t, "Sue", "neighbor", "neighbor")]; }).flat());
  assert.deepStrictEqual(primed(ed).sort(), ["Ann", "Bob", "Sue"]);
  assert.strictEqual(E.classifyEntry("Pastor Williams").name, "Pastor Williams");
  assert.strictEqual(E.classifyEntry("Pastor Williams, friend").name, "Pastor Williams");
  assert.strictEqual(E.classifyEntry("Ann").cls, "name_only");
});
T("regression: an entry mentioning another person next to a spouse term is excluded whole (documented over-exclusion), neighbours elsewhere untouched", async () => {
  const ed = await sc({ transport: ["Kate and my husband Tom"], job: ["Tom"], money: ["Bob, my brother"], other: ["Ann"] });
  assert.deepStrictEqual(primed(ed), ["Bob", "Ann"]);
});

(async () => {
  let nBad = 0;
  for (const [label, fn] of tests) {
    try { await fn(); console.log("ok    " + label); }
    catch (e) { nBad++; console.error("FAIL  " + label + "\n        " + String(e && e.message).split("\n").slice(0, 3).join("\n        ")); }
  }
  const BAD = [/\bnull\b/i, /N\/A/i, /undefined/i, /\[object/i, /your your/i, /\btrue\b/i, /\bfalse\b/i, /\bnan\b/i, /\(your (the|a|an)\b/i];
  for (const t of TEXTS) for (const re of BAD) if (re.test(t)) { nBad++; console.error("FAIL  stimulus matches " + re + ": " + t.slice(0, 120)); }
  console.log(nBad ? `test-spouse: ${nBad} FAILED of ${tests.length}` : `test-spouse: all ${tests.length} pass`);
  process.exit(nBad ? 1 : 0);
})();
