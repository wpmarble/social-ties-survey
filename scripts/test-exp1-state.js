// Test: exp1-ad.js fills [STATE] with the respondent's state, adding "the" for DC / U.S. Virgin Islands / Northern Mariana Islands,
// and falls back to "your state" when resp_state is empty or an unresolved pipe.
// Runs the pasted script in a Qualtrics-like vm stub against the real exp1/control-valence.txt.
// Run: node scripts/test-exp1-state.js   (exit 0 = all pass)
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "exp1-ad.js"), "utf8");
const arm = fs.readFileSync(path.join(__dirname, "..", "exp1", "control-valence.txt"), "utf8");
if (!/\[STATE\]/.test(arm)) { console.log("FAIL control-valence.txt has no [STATE]"); process.exit(1); }

async function run(respState) {
  const s = src.split("${e://Field/resp_state}").join(respState).split("${e://Field/resp_id}").join("R_testID12345");
  const ed = {}; let handler = null;
  const el = () => ({ innerHTML: "", textContent: "", style: {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; } });
  const ctx = {
    console: { log() {}, error() {}, warn() {} }, Math, JSON, Date, Promise, setTimeout, clearTimeout, parseInt, String, isNaN, Object, Array, RegExp,
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(arm) }),
    document: { getElementById: () => el(), createElement: () => el(), createTextNode: () => ({}), getElementsByTagName: () => [{ appendChild() {} }], querySelectorAll: () => [] },
    Qualtrics: { SurveyEngine: { addOnload: f => { handler = f; }, addOnReady() {}, addOnUnload() {}, addOnPageSubmit() {}, setEmbeddedData: (a, b) => { ed[a] = String(b); } } }
  };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(s, ctx);
  handler.call({ hideNextButton() {}, showNextButton() {}, questionId: "QID73", getChoiceContainer: () => el(), getQuestionContainer: () => el() });
  for (let i = 0; i < 20; i++) await Promise.resolve();   // let fetch().then() chains settle
  return ed;
}

(async () => {
  let fails = 0;
  const check = (name, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  " + (extra || ""))); if (!ok) fails++; };
  const cases = [
    ["District of Columbia", "the District of Columbia"], ["U.S. Virgin Islands", "the U.S. Virgin Islands"],
    ["Northern Mariana Islands", "the Northern Mariana Islands"], ["Ohio", "Ohio"], ["Puerto Rico", "Puerto Rico"],
    ["", "your state"], ["${e://Field/not_set}", "your state"],
  ];
  for (const [inp, want] of cases) {
    const t = (await run(inp)).exp1_treatment_text || "";
    const expected = arm.replace(/\[STATE\]/gi, want).replace(/\[CANDIDATE NAME\]/gi, "Mark Anderson").replace(/\[CANDIDATE LAST NAME\]/gi, "Anderson");
    check(`resp_state=${JSON.stringify(inp)} -> "${want}" in every [STATE] slot`, t === expected && !/\[STATE\]/.test(t) && !/\bthe the\b/i.test(t),
      "got: " + t.slice(0, 120));
  }
  console.log(fails ? `FAILED: ${fails}` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
