// vm tests for the arm-specific Exp 2B reflection prompt set by exp2b-threat.js on the #exp2bReflectPrompt span (QID76).
// Run: node scripts/test-exp2b-reflect.js   (exit 0 = all pass)
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const SRC = fs.readFileSync(path.join(__dirname, "exp2b-threat.js"), "utf8");
const THREAT = "Take a moment to think about this. In a few sentences, what would be on your mind about your work and your finances if you were in this situation?";
const PLACEBO = "Take a moment to think about this. In a few sentences, what would be on your mind as you get to work or run errands?";
const NEUTRAL = "Take a moment to think about this. In a few sentences, what is on your mind after reading this?";

// spanAppearsAfter: number of getElementById("exp2bReflectPrompt") calls that return null before the span exists (Infinity = never)
function run({ existing = "", respId = "R_test", spanAppearsAfter = 0 }) {
  const ed = {}, errors = [], timers = [];
  const span = { textContent: NEUTRAL };
  const display = { innerHTML: "" };
  let spanCalls = 0;
  const ctx = {
    Math, Date, String, Promise, parseInt, isNaN, JSON,
    console: { log() {}, error: (...a) => errors.push(a.join(" ")) },
    document: { getElementById: (id) => {
      if (id === "exp2bReflectPrompt") return (spanCalls++ >= spanAppearsAfter) ? span : null;
      if (id === "exp2bDisplay") return display;
      return null; } },
    fetch: () => Promise.reject(new Error("no network in test")),     // stimulus falls back to inline text; irrelevant here
    setTimeout: (f) => { timers.push(f); },                           // run manually: no real waiting
    Qualtrics: { SurveyEngine: { setEmbeddedData: (k, v) => { ed[k] = v; }, addOnload: (f) => { ctx._onload = f; } } },
  };
  const code = SRC.split("${e://Field/exp2b_arm}").join(existing).split("${e://Field/resp_id}").join(respId)
    .split("${q://QID23/SelectedChoicesRecode}").join("5").split("${q://QID28/SelectedChoicesRecode}").join("7");
  vm.createContext(ctx); vm.runInContext(code, ctx); ctx._onload.call({});
  let ticks = 0;
  while (timers.length && ticks < 200) { timers.shift()(); ticks++; }   // drain the polling loop
  return { ed, span, errors, spanCalls, ticks };
}

let n = 0;
const t = (name, f) => { f(); n++; console.log("PASS " + name); };

t("reuse path: existing=threat -> threat prompt in span and ED", () => {
  const r = run({ existing: "threat" });
  assert.strictEqual(r.ed.exp2b_arm, "threat"); assert.strictEqual(r.span.textContent, THREAT); assert.strictEqual(r.ed.exp2b_reflect_prompt, THREAT);
});
t("reuse path: existing=placebo -> placebo prompt in span and ED", () => {
  const r = run({ existing: "placebo" });
  assert.strictEqual(r.ed.exp2b_arm, "placebo"); assert.strictEqual(r.span.textContent, PLACEBO); assert.strictEqual(r.ed.exp2b_reflect_prompt, PLACEBO);
});
t("fresh draw: both arms occur across respondent IDs and prompt always matches the arm drawn", () => {
  const seen = {};
  for (let i = 0; i < 60; i++) {
    const r = run({ respId: "R_" + i });
    seen[r.ed.exp2b_arm] = (seen[r.ed.exp2b_arm] || 0) + 1;
    const want = r.ed.exp2b_arm === "threat" ? THREAT : PLACEBO;
    assert.strictEqual(r.span.textContent, want); assert.strictEqual(r.ed.exp2b_reflect_prompt, want);
  }
  assert.ok(seen.threat > 5 && seen.placebo > 5, JSON.stringify(seen));
});
t("reuse beats the seed: existing arm wins over what the resp_id would draw", () => {
  let id = null;
  for (let i = 0; i < 60 && !id; i++) if (run({ respId: "R_" + i }).ed.exp2b_arm === "threat") id = "R_" + i;
  const r = run({ respId: id, existing: "placebo" });
  assert.strictEqual(r.ed.exp2b_arm, "placebo"); assert.strictEqual(r.span.textContent, PLACEBO);
});
t("span appears late (after 10 polls, within the 2 s budget): prompt still set", () => {
  const r = run({ existing: "placebo", spanAppearsAfter: 10 });
  assert.strictEqual(r.span.textContent, PLACEBO); assert.strictEqual(r.ed.exp2b_reflect_prompt, PLACEBO); assert.strictEqual(r.errors.length, 0);
});
t("span appears at the last allowed poll (40th): prompt still set", () => {
  const r = run({ existing: "threat", spanAppearsAfter: 39 });
  assert.strictEqual(r.span.textContent, THREAT);
});
t("missing span: neutral fallback stays, ED = 'fallback', error logged, polling is bounded (40 polls = 2 s)", () => {
  const r = run({ existing: "threat", spanAppearsAfter: Infinity });
  assert.strictEqual(r.span.textContent, NEUTRAL); assert.strictEqual(r.ed.exp2b_reflect_prompt, "fallback");
  assert.ok(r.errors.some(e => e.indexOf("exp2bReflectPrompt") !== -1), "error logged");
  assert.strictEqual(r.spanCalls, 40);
  assert.strictEqual(r.ed.exp2b_arm, "threat", "arm unaffected by the missing span");
});
t("exact strings: threat prompt == the original QID76 text", () => { assert.ok(SRC.indexOf(THREAT) !== -1 && SRC.indexOf(PLACEBO) !== -1); });
t("no '$' followed by '{' beyond the intended pipes", () => {
  assert.deepStrictEqual((SRC.match(/\$\{[^}]*\}/g) || []).sort(),
    ["${e://Field/exp2b_arm}", "${e://Field/resp_id}", "${q://QID23/SelectedChoicesRecode}", "${q://QID28/SelectedChoicesRecode}"]);
});
console.log("test-exp2b-reflect.js: " + n + " checks passed");
