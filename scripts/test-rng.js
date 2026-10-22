// Tests for the seeded arm draw shared by the three PASTED scripts: exp1-ad.js, exp2b-threat.js and the
// generated exp2a-render.js (run `node scripts/exp2a-build.js` first; run_tests.sh does).
// Run: node scripts/test-rng.js            (exit 0 = all pass)
//      node scripts/test-rng.js --broken   (negative control: salt-ignoring RNG; check 3 must FAIL, exit 1)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BROKEN = process.argv.includes("--broken");
const FILES = { exp1: "exp1-ad.js", exp2b: "exp2b-threat.js", exp2a: "exp2a-render.js" };
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

// ---- Golden vectors -------------------------------------------------------------------------
// Computed ONCE with the independent MediaGaza reference
//   ~/Dropbox/MediaGaza/08surveys/2026-fall/survey/scripts/randomizer.js  (fnv1a, mulberry32)
// and hardcoded here. If that file exists at test time it is loaded separately and cross-checked live too.
const GOLD_FNV = [["", 2166136261], ["a", 3826002220], ["The quick brown fox", 2924308450], ["R_3kLm9xQ2pZa7Bc1", 904129431],
  ["exp1:R_3kLm9xQ2pZa7Bc1", 3553357069], ["exp2a:R_3kLm9xQ2pZa7Bc1", 2282489911], ["exp2b:R_3kLm9xQ2pZa7Bc1", 4062288310],
  ["exp1:R_abc", 210006540], ["exp2a:R_1", 4020971997], ["exp2b:R_1", 2033469244]];
// mulberry32(seed): first three outputs as floor(u * 2^32)
const GOLD_MB = [[0, [1144304738, 1416247, 958946056]], [1, [2693262067, 11749833, 2265367787]],
  [12345, [4207900869, 1317490944, 2079646450]], [3735928559, [4043151706, 1147597007, 3315858022]]];
// (salt, respId, k arms) -> arm index = floor(mulberry32(fnv1a(salt + ":" + respId))() * k)
const GOLD_ARM = [
  ["exp1", "R_3kLm9xQ2pZa7Bc1", 4, 1], ["exp1", "R_1", 4, 2], ["exp1", "R_abcdefghijklmno", 4, 0],
  ["exp1", "R_6Hq0VtWnY4sEjDu", 4, 3], ["exp1", "R_2zXcVbNmAsDfGhJ", 4, 1],
  ["exp2b", "R_3kLm9xQ2pZa7Bc1", 2, 0], ["exp2b", "R_1", 2, 1], ["exp2b", "R_abcdefghijklmno", 2, 0],
  ["exp2b", "R_6Hq0VtWnY4sEjDu", 2, 0], ["exp2b", "R_2zXcVbNmAsDfGhJ", 2, 1],
  ["exp2a", "R_3kLm9xQ2pZa7Bc1", 2, 1], ["exp2a", "R_1", 2, 0], ["exp2a", "R_abcdefghijklmno", 2, 0],
  ["exp2a", "R_6Hq0VtWnY4sEjDu", 2, 0], ["exp2a", "R_2zXcVbNmAsDfGhJ", 2, 1]];

// Independent BigInt reference (no Math.imul, no >>> tricks) used for the 200-ID sweeps; itself pinned to the vectors above.
const M32 = 0xFFFFFFFFn;
function refFnv(str) { let h = 0x811c9dc5n; for (let i = 0; i < str.length; i++) { h ^= BigInt(str.charCodeAt(i)); h = (h * 16777619n) & M32; } return Number(h); }
function refMb(seed) {
  let a = BigInt(seed) & M32;
  const mul = (x, y) => (x * y) & M32;
  return () => {
    a = (a + 0x6D2B79F5n) & M32;
    let t = a;
    t = mul(t ^ (t >> 15n), t | 1n);
    t = t ^ ((t + mul(t ^ (t >> 7n), t | 61n)) & M32);
    return Number((t ^ (t >> 14n)) & M32) / 4294967296;
  };
}
const refArm = (arms, salt, id) => arms[Math.floor(refMb(refFnv(salt + ":" + id))() * arms.length)];
let MG = null;
try { MG = require(path.join(process.env.HOME, "Dropbox/MediaGaza/08surveys/2026-fall/survey/scripts/randomizer.js")); } catch (e) { MG = null; }
console.log(MG ? "(MediaGaza randomizer.js found: live cross-check on)" : "(MediaGaza randomizer.js not found: hardcoded vectors only)");

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
  vm.runInContext(blockText + "\nthis.drawArm = drawArm; this.drawArmWithFallback = drawArmWithFallback; this.fnv1a = fnv1a; this.mulberry32 = mulberry32;", ctx);
  return ctx;
}
const haveBlocks = Object.values(blocks).every(b => b);
check("0. each file has exactly one RNG block", haveBlocks);
if (!haveBlocks) process.exit(1);

const SALT = {}, ARMLIST = {}, draws = {}, fns = {};
const EXPECT_SALT = { exp1: "exp1", exp2b: "exp2b", exp2a: "exp2a" };
// Golden ARMS arrays, IN ORDER. drawArm indexes into ARMS, so swapping two arms silently reassigns respondents.
// Changing an arm list or its order is a deliberate design change: update these values in the same commit.
const EXPECT_ARMS = {
  exp1: ["anti-baseline", "anti-fiscal", "anti-crowdout", "control-valence"],
  exp2b: ["threat", "placebo"],
  exp2a: ["tie", "placebo"]
};
for (const k in src) {
  const m = src[k].match(/drawArmWithFallback\(ARMS, "([^"]+)"/);
  SALT[k] = m ? m[1] : null;
  const a = src[k].match(/\bARMS = (\[[^\]]*\])/);
  ARMLIST[k] = a ? JSON.parse(a[1]) : null;
  fns[k] = load(blocks[k]);
}
check("0b. each script's salt and ARMS list extracted and as expected",
  Object.keys(src).every(k => SALT[k] === EXPECT_SALT[k] && ARMLIST[k] && ARMLIST[k].length >= 2),
  JSON.stringify(SALT));
check("0b2. each script's ARMS array equals the golden list exactly, in order",
  Object.keys(src).every(k => JSON.stringify(ARMLIST[k]) === JSON.stringify(EXPECT_ARMS[k])),
  Object.keys(src).filter(k => JSON.stringify(ARMLIST[k]) !== JSON.stringify(EXPECT_ARMS[k])).map(k => k + ": " + JSON.stringify(ARMLIST[k])).join("; "));
check("0c. salts are pairwise distinct", new Set(Object.values(SALT)).size === 3);
const real = fns.exp1;
// Negative control: RNG that ignores the salt, so every experiment gets the same arm index.
for (const k in src) draws[k] = BROKEN ? (arms, salt, id) => fns[k].drawArm(arms, "", id) : fns[k].drawArm;
if (BROKEN) console.log("*** --broken: salt-ignoring RNG swapped in; check 3 is expected to FAIL ***");

// G. golden vectors, against each pasted file's own block
for (const k in src) {
  const f = fns[k];
  check("G1. " + k + ": fnv1a golden vectors", GOLD_FNV.every(([x, w]) => f.fnv1a(x) === w && refFnv(x) === w && (!MG || MG.fnv1a(x) === w)));
  check("G2. " + k + ": mulberry32 first three outputs", GOLD_MB.every(([sd, w]) => {
    const r = f.mulberry32(sd), g = [r(), r(), r()].map(u => Math.floor(u * 4294967296));
    return g.join() === w.join() && (!MG || (() => { const q = MG.mulberry32(sd); return [q(), q(), q()].map(u => Math.floor(u * 4294967296)).join() === w.join(); })());
  }));
  const kArms = {}; // arm lists of length k
  check("G3. " + k + ": drawArm golden (salt, respId) -> arm index (all 15 vectors, incl. other experiments' salts)", GOLD_ARM.every(([salt, id, n, w]) => {
    const arms = []; for (let i = 0; i < n; i++) arms.push(i);
    return f.drawArm(arms, salt, id) === w && (!MG || Math.floor(MG.mulberry32(MG.fnv1a(salt + ":" + id))() * n) === w);
  }));
}

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
    for (const k in src) {
      const a = draws[k](["a", "b", "c", "d"], SALT[k], id);
      for (let r = 0; r < 3; r++) if (draws[k](["a", "b", "c", "d"], SALT[k], id) !== a) ok = false;
    }
  }
  check("1. same (salt, respId) -> same arm", ok);
}

// 2. balance
const ids5k = []; for (let i = 0; i < 5000; i++) ids5k.push(rid(lcg));
for (const e of Object.keys(src)) {
  const salt = SALT[e], arms = ARMLIST[e], k = arms.length;
  const cnt = {}; arms.forEach(a => cnt[a] = 0);
  ids5k.forEach(id => cnt[draws[e](arms, salt, id)]++);
  const dev = Math.max.apply(null, arms.map(a => Math.abs(cnt[a] / ids5k.length - 1 / k)));
  check("2. balance k=" + k + " salt=" + salt + " within +/-0.02", dev <= 0.02, "max dev " + dev.toFixed(4));
}

// 3. independence of exp1 x exp2a x exp2b
{
  const A1 = ["a0", "a1", "a2", "a3"], A2 = ["t", "p"], A3 = ["t", "p"];
  const N = 20000, cells = {};
  for (let i = 0; i < N; i++) {
    const id = rid(lcg);
    // each script's own drawArm with the salt extracted from that script
    const key = draws.exp1(A1, SALT.exp1, id) + "|" + draws.exp2a(A2, SALT.exp2a, id) + "|" + draws.exp2b(A3, SALT.exp2b, id);
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
  const okSame = c.drawArmWithFallback(["a", "b"], "exp1", "R_abc123").arm === refArm(["a", "b"], "exp1", "R_abc123");
  check("6a. function: empty / pipe-prefixed / null respId -> fallback=true; valid id -> false and equals drawArm", okFb && okReal && okSame);

  const armKey = { exp1: "exp1_tr_arm", exp2b: "exp2b_arm", exp2a: "exp2a_arm" };
  const armsOf = ARMLIST;
  // 6b. end-to-end in a Qualtrics-like vm sandbox, each of the three scripts
  function run(k, resp, existingArm) {
    let s = src[k];
    if (resp !== null) s = s.split("${e://Field/resp_id}").join(resp);
    if (existingArm !== undefined) s = s.split("${e://Field/" + armKey[k] + "}").join(existingArm);
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
    vm.runInContext(s, ctx);
    const q = { hideNextButton() {}, showNextButton() {}, questionId: "QID1", getChoiceContainer: () => el(), getQuestionContainer: () => el() };
    try { handler.call(q); } catch (e) { ed.__threw = String(e); }
    return ed;
  }
  let ok = true, msgs = [];
  for (const k of Object.keys(FILES)) {
    for (const bad of [null /* leave pipe literal */, ""]) {
      const ed = run(k, bad);
      if (ed.rng_seed_fallback !== "1" || ed.rand_version !== "1" || armsOf[k].indexOf(ed[armKey[k]]) < 0) { ok = false; msgs.push(k + " fallback e2e " + JSON.stringify(bad)); }
    }
    const ed = run(k, "R_testID12345");
    const want = refArm(armsOf[k], EXPECT_SALT[k], "R_testID12345");
    if (ed.rng_seed_fallback !== undefined || ed.rand_version !== "1" || ed[armKey[k]] !== want) { ok = false; msgs.push(k + " seeded e2e got " + ed[armKey[k]] + " want " + want); }
  }
  check("6b. all three scripts run in a vm Qualtrics stub: fallback sets rng_seed_fallback=1, seeded path does not; arm == reference; rand_version=1", ok, msgs.join("; "));
  // 6c. sweep: ~200 IDs through each pasted script in the vm; arm must equal the golden reference every time
  {
    let bad = [], n = 0;
    const sweepIds = ["R_1", "R_3kLm9xQ2pZa7Bc1"]; for (let i = 0; i < 198; i++) sweepIds.push(rid(lcg));
    for (const k of Object.keys(FILES)) {
      const seen = {};
      for (const id of sweepIds) {
        const ed = run(k, id), want = refArm(armsOf[k], EXPECT_SALT[k], id);
        n++; seen[ed[armKey[k]]] = 1;
        if (ed[armKey[k]] !== want) bad.push(k + " " + id + " got " + ed[armKey[k]] + " want " + want);
      }
      if (Object.keys(seen).length !== armsOf[k].length) bad.push(k + " sweep did not reach every arm");
    }
    check("6c. 200 IDs x 3 scripts: vm arm == independent reference every time, every arm reached", bad.length === 0, n + " runs; " + bad.slice(0, 3).join("; "));
  }

  // 6d. reuse: a valid pre-existing arm is kept (even when it differs from the seeded draw); an invalid one is redrawn
  {
    const bad = [];
    for (const k of Object.keys(FILES)) {
      for (const id of ["R_1", "R_3kLm9xQ2pZa7Bc1", "R_abcdefghijklmno", "R_6Hq0VtWnY4sEjDu"]) {
        const want = refArm(armsOf[k], EXPECT_SALT[k], id);
        const other = armsOf[k].filter(a => a !== want)[0];
        const kept = run(k, id, other);
        if (kept[armKey[k]] !== other) bad.push(k + " " + id + ": valid existing arm " + other + " not reused (got " + kept[armKey[k]] + ")");
        if (kept.rng_seed_fallback !== undefined) bad.push(k + ": reuse set fallback flag");
        for (const junk of ["bogus-arm", "THREAT", "0"]) {
          const re = run(k, id, junk);
          if (re[armKey[k]] !== want) bad.push(k + " " + id + ": invalid existing '" + junk + "' not redrawn (got " + re[armKey[k]] + ", want " + want + ")");
        }
      }
    }
    check("6d. valid existing arm reused / invalid existing arm redrawn, all three scripts", bad.length === 0, bad.slice(0, 3).join("; "));
  }
}

const failed = results.filter(r => !r.ok).map(r => r.name);
console.log(failed.length ? "\n" + failed.length + " FAILED" : "\nALL PASSED");
process.exit(failed.length ? 1 : 0);
