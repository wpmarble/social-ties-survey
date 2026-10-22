// Tests for the seeded arm draw shared by exp1-ad.js, exp2b-threat.js, exp2a-hooks/render-hook.js.
// Run: node scripts/test-rng.js            (exit 0 = all pass)
//      node scripts/test-rng.js --broken   (negative control: salt-ignoring RNG; check 3 must FAIL, exit 1)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BROKEN = process.argv.includes("--broken");
const FILES = { exp1: "exp1-ad.js", exp2b: "exp2b-threat.js", exp2a: "exp2a-hooks/render-hook.js" };
const src = {};
for (const k in FILES) src[k] = fs.readFileSync(path.join(__dirname, FILES[k]), "utf8");

const BEGIN = "// >>> RNG BLOCK BEGIN";
const END = "// <<< RNG BLOCK END <<<";
function blockOf(s) {
  const i = s.indexOf(BEGIN), j = s.indexOf(END);
  if (i < 0 || j < 0 || s.indexOf(BEGIN, i + 1) >= 0) return null;
  return s.slice(i, j + END.length);
}
const blocks = {};
for (const k in src) blocks[k] = blockOf(src[k]);

let nFail = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) nFail++;
}

// Load the block text (the very bytes pasted into Qualtrics) into a sandbox.
function load(blockText, fakeDate) {
  const ctx = { Math, Date: fakeDate || Date, String };
  vm.createContext(ctx);
  vm.runInContext(blockText + "\nthis.drawArm = drawArm; this.drawArmWithFallback = drawArmWithFallback;", ctx);
  return ctx;
}
const haveBlocks = Object.values(blocks).every(b => b);
check("0. each file has exactly one RNG block", haveBlocks);
if (!haveBlocks) process.exit(1);

const real = load(blocks.exp1);
// Negative control: RNG that ignores the salt, so every experiment gets the same arm index.
const drawArm = BROKEN ? (arms, salt, id) => real.drawArm(arms, "", id) : real.drawArm;
if (BROKEN) console.log("*** --broken: salt-ignoring RNG swapped in; check 3 is expected to FAIL ***");

function rid(rnd) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "R_";
  for (let i = 0; i < 15; i++) s += A[Math.floor(rnd() * A.length)];
  return s;
}
// deterministic test-ID generator (independent of the code under test)
let st = 12345;
const lcg = () => (st = (st * 1664525 + 1013904223) % 4294967296) / 4294967296;

// 1. determinism
{
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const id = rid(lcg);
    for (const salt of ["exp1", "exp2a", "exp2b"]) {
      const a = drawArm(["a", "b", "c", "d"], salt, id);
      for (let r = 0; r < 3; r++) if (drawArm(["a", "b", "c", "d"], salt, id) !== a) ok = false;
    }
  }
  check("1. same (salt, respId) -> same arm", ok);
}

// 2. balance
const ids5k = []; for (let i = 0; i < 5000; i++) ids5k.push(rid(lcg));
for (const [k, salt] of [[4, "exp1"], [2, "exp2b"], [2, "exp2a"]]) {
  const arms = []; for (let i = 0; i < k; i++) arms.push("arm" + i);
  const cnt = {}; arms.forEach(a => cnt[a] = 0);
  ids5k.forEach(id => cnt[drawArm(arms, salt, id)]++);
  const dev = Math.max.apply(null, arms.map(a => Math.abs(cnt[a] / ids5k.length - 1 / k)));
  check("2. balance k=" + k + " salt=" + salt + " within +/-0.02", dev <= 0.02, "max dev " + dev.toFixed(4));
}

// 3. independence of exp1 x exp2a x exp2b
{
  const A1 = ["a0", "a1", "a2", "a3"], A2 = ["t", "p"], A3 = ["t", "p"];
  const N = 20000, cells = {};
  for (let i = 0; i < N; i++) {
    const id = rid(lcg);
    const key = drawArm(A1, "exp1", id) + "|" + drawArm(A2, "exp2a", id) + "|" + drawArm(A3, "exp2b", id);
    cells[key] = (cells[key] || 0) + 1;
  }
  const expShare = 1 / 16;
  let maxDev = 0, chi = 0, nCells = 0;
  for (const a of A1) for (const b of A2) for (const c of A3) {
    const o = cells[a + "|" + b + "|" + c] || 0;
    maxDev = Math.max(maxDev, Math.abs(o / N - expShare));
    chi += Math.pow(o - N * expShare, 2) / (N * expShare);
    nCells++;
  }
  // df = 15; chi-square critical value at p = 0.001 is 37.70
  check("3. exp1 x exp2a x exp2b independent (chi2<37.70, df=15, p>0.001; cells within +/-0.02 of 1/16)",
    chi < 37.70 && maxDev <= 0.02, "chi2 " + chi.toFixed(1) + ", max cell dev " + maxDev.toFixed(4) + ", cells " + nCells);
}

// 4. byte-identical blocks
check("4. RNG blocks byte-identical across the three files",
  blocks.exp1 === blocks.exp2b && blocks.exp1 === blocks.exp2a);

// 5. no stray ${ ; no ES6 in RNG block
{
  const bad = [];
  for (const k in src) {
    const stripped = src[k].replace(/\$\{(?:e|q):\/\/[A-Za-z0-9_\/]+\}/g, "");
    if (stripped.indexOf("${") >= 0) bad.push(k + ": stray dollar-brace");
  }
  const es6 = [/\blet\s/, /\bconst\s/, /=>/, /`/];
  for (const k in blocks) for (const re of es6) if (re.test(blocks[k])) bad.push(k + " RNG block has ES6 token " + re);
  // changed lines outside the block must be ES5 too: check the seed/draw code added to each script
  for (const k in src) {
    const after = src[k].slice(src[k].indexOf(END));
    const m = after.match(/resp_id[\s\S]{0,900}?RAND_VERSION\);/);
    if (!m) bad.push(k + ": draw code not found");
    else for (const re of es6) if (re.test(m[0])) bad.push(k + " draw code has ES6 token " + re);
  }
  check("5. no stray dollar-brace; no ES6 tokens in RNG block / draw code", bad.length === 0, bad.join("; "));
}

// 6. fallback
{
  const fixedNow = { now: () => 1700000000000 };
  const c = load(blocks.exp1);
  const cases = ["", "   ", "${e://Field/resp_id}", "$whatever", null, undefined];
  const okFb = cases.every(x => c.drawArmWithFallback(["a", "b"], "exp1", x).fallback === true);
  const okReal = c.drawArmWithFallback(["a", "b"], "exp1", "R_abc123").fallback === false;
  const okSame = c.drawArmWithFallback(["a", "b"], "exp1", "R_abc123").arm === c.drawArm(["a", "b"], "exp1", "R_abc123");
  check("6a. function: empty / pipe-prefixed / null respId -> fallback=true; valid id -> false and equals drawArm", okFb && okReal && okSame);

  // 6b. end-to-end in a Qualtrics-like vm sandbox, each of the three scripts
  function run(k, resp, existingArmField) {
    let s = src[k];
    if (resp !== null) s = s.split("${e://Field/resp_id}").join(resp);
    const ed = {}; let handler = null;
    const el = () => ({ innerHTML: "", textContent: "", style: {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; } });
    const ctx = {
      console: { log() {}, error() {}, warn() {} }, Math, JSON, Date, Promise, setTimeout, parseInt, String, isNaN, Object, Array, RegExp,
      fetch: () => new Promise(() => {}),
      document: { getElementById: () => el(), createElement: () => el(), createTextNode: () => ({}), getElementsByTagName: () => [{ appendChild() {} }], querySelectorAll: () => [] },
      EXP2A: undefined,
      Qualtrics: { SurveyEngine: { addOnload: f => { handler = f; }, addOnReady() {}, addOnUnload() {}, addOnPageSubmit() {},
        setEmbeddedData: (a, b) => { ed[a] = String(b); } } }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    if (k === "exp2a") { // render hook needs the core
      const core = fs.readFileSync(path.join(__dirname, "exp2a-core.js"), "utf8");
      s = core + "\n" + s;
    }
    vm.runInContext(s, ctx);
    const q = { hideNextButton() {}, showNextButton() {}, questionId: "QID1", getChoiceContainer: () => el(), getQuestionContainer: () => el() };
    try { handler.call(q); } catch (e) { ed.__threw = String(e); }
    return ed;
  }
  const armKey = { exp1: "exp1_tr_arm", exp2b: "exp2b_arm", exp2a: "exp2a_arm" };
  const armsOf = { exp1: ["anti-baseline", "anti-fiscal", "anti-crowdout", "control-valence"], exp2b: ["threat", "placebo"], exp2a: ["tie", "placebo"] };
  let ok = true, msgs = [];
  for (const k of Object.keys(FILES)) {
    for (const bad of [null /* leave pipe literal */, ""]) {
      const ed = run(k, bad);
      if (ed.rng_seed_fallback !== "1" || ed.rand_version !== "1" || armsOf[k].indexOf(ed[armKey[k]]) < 0) { ok = false; msgs.push(k + " fallback e2e " + JSON.stringify(bad)); }
    }
    const ed = run(k, "R_testID12345");
    const want = real.drawArm(armsOf[k], k, "R_testID12345");
    if (ed.rng_seed_fallback !== undefined || ed.rand_version !== "1" || ed[armKey[k]] !== want) { ok = false; msgs.push(k + " seeded e2e got " + ed[armKey[k]] + " want " + want); }
  }
  check("6b. all three scripts run in a vm Qualtrics stub: fallback sets rng_seed_fallback=1, seeded path does not; arm == drawArm; rand_version=1", ok, msgs.join("; "));
}

const failed = results.filter(r => !r.ok).map(r => r.name);
console.log(failed.length ? "\n" + failed.length + " FAILED" : "\nALL PASSED");
process.exit(failed.length ? 1 : 0);
