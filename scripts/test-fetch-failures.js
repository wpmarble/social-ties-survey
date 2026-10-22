// vm tests (mocked fetch + fake timers) for exp1-ad.js and exp2b-threat.js failure handling:
// every fetch has an 8s timeout and an r.ok check; failures set exp1_error / exp2b_error, never store error bodies as stimulus text,
// Exp 1 shows Next promptly, Exp 2B falls back to the inline generic/placebo text.
// Run: node scripts/test-fetch-failures.js   (exit 0 = all pass)
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const R = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const EXP1 = R("scripts/exp1-ad.js"), EXP2B = R("scripts/exp2b-threat.js");
const ERR_BODY = "<html><body>404 Not Found ERRORBODY</body></html>";

function fakeEnv({ fetchImpl, abort }) {
  const timers = [], ed = {}, calls = { hide: 0, show: 0, aborted: 0, showAt: [] };
  const els = {};
  const el = () => ({ innerHTML: "", textContent: "", style: {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; } });
  const ctx = {
    Math, Date, String, Promise, parseInt, isNaN, JSON, Object, Array, RegExp,
    console: { log() {}, error() {}, warn() {} },
    setTimeout: (f, ms) => { const t = { f, ms, id: timers.length, live: true }; timers.push(t); return t.id; },
    clearTimeout: (id) => { if (timers[id]) timers[id].live = false; },
    fetch: (url, opts) => fetchImpl(url, opts),
    document: {
      getElementById: (id) => (id === "adDisplay" || id === "exp2bDisplay") ? (els[id] = els[id] || el()) : (id === "exp2bReflectPrompt" ? (els[id] = els[id] || el()) : null),
      createElement: el, createTextNode: () => ({}), getElementsByTagName: () => [{ appendChild() {} }], querySelectorAll: () => []
    },
    Qualtrics: { SurveyEngine: { addOnload: f => { ctx._onload = f; }, setEmbeddedData: (k, v) => { ed[k] = String(v); } } },
  };
  if (abort) ctx.AbortController = function () { this.signal = { s: 1 }; this.abort = () => { calls.aborted++; }; };
  ctx.window = ctx;
  const qThis = { hideNextButton() { calls.hide++; }, showNextButton() { calls.show++; calls.showAt.push(timers.length); } };
  return { ctx, timers, ed, calls, els, qThis };
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
// fire every live timer with ms <= limit (earliest-first), flushing microtasks between
async function fireTimers(env, limit) {
  for (let k = 0; k < 50; k++) {
    const t = env.timers.filter(x => x.live && x.ms <= limit)[0];
    if (!t) break;
    t.live = false; t.f(); await flush();
  }
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) });
const HANG = () => new Promise(() => {});

function prep(src, ctx, pipes) {
  let s = src; for (const [k, v] of Object.entries(pipes)) s = s.split(k).join(v);
  vm.createContext(ctx); vm.runInContext(s, ctx);
}
async function runExp1(fetchImpl, abort) {
  const env = fakeEnv({ fetchImpl, abort });
  prep(EXP1, env.ctx, { "${e://Field/resp_state}": "Ohio", "${e://Field/exp1_tr_arm}": "", "${e://Field/resp_id}": "R_test1" });
  env.ctx._onload.call(env.qThis); await flush();
  return env;
}
let n = 0;
const t = async (name, f) => { await f(); n++; console.log("PASS " + name); };

(async () => {
  const GOOD = "[CANDIDATE NAME] grew up in [STATE].\n\nPaid for by someone.";
  for (const abort of [true, false]) {
    const tag = abort ? " (AbortController)" : " (no AbortController: setTimeout race)";
    await t("exp1 404 -> Next shown, empty card, exp1_error=http_404, no body stored" + tag, async () => {
      const env = await runExp1(() => Promise.resolve(resp(404, ERR_BODY)), abort);
      assert.strictEqual(env.ed.exp1_error, "http_404"); assert.ok(env.calls.show >= 1);
      assert.strictEqual(env.els.adDisplay.innerHTML, ""); assert.ok(!env.ed.exp1_treatment_text);
      assert.ok(JSON.stringify(env.ed).indexOf("ERRORBODY") === -1);
    });
    await t("exp1 network reject -> exp1_error=network" + tag, async () => {
      const env = await runExp1(() => Promise.reject(new TypeError("Failed to fetch")), abort);
      assert.strictEqual(env.ed.exp1_error, "network"); assert.ok(env.calls.show >= 1);
      assert.strictEqual(env.els.adDisplay.innerHTML, ""); assert.ok(!env.ed.exp1_treatment_text);
    });
    await t("exp1 hang -> after the 8s timer: Next shown, exp1_error=timeout" + tag, async () => {
      const env = await runExp1(HANG, abort);
      assert.strictEqual(env.calls.show, 0, "Next hidden while waiting"); assert.strictEqual(env.calls.hide, 1);
      const to = env.timers.filter(x => x.live && x.ms >= 5000);
      assert.ok(to.length >= 1 && Math.max(...to.map(x => x.ms)) <= 8000, "a timeout timer <= 8000 ms is armed: " + JSON.stringify(env.timers.map(x => x.ms)));
      await fireTimers(env, 8000);
      assert.strictEqual(env.ed.exp1_error, "timeout"); assert.ok(env.calls.show >= 1);
      assert.strictEqual(env.els.adDisplay.innerHTML, ""); assert.ok(!env.ed.exp1_treatment_text);
      if (abort) assert.strictEqual(env.calls.aborted, 1);
    });
  }
  await t("exp1 success -> card rendered, text stored, no exp1_error, Next after READ_DELAY only", async () => {
    const env = await runExp1(() => Promise.resolve(resp(200, GOOD)), true);
    assert.ok(env.ed.exp1_treatment_text.indexOf("Mark Anderson grew up in Ohio.") === 0);
    assert.ok(env.els.adDisplay.innerHTML.indexOf("exp1-ad-card") !== -1); assert.ok(!("exp1_error" in env.ed));
    assert.strictEqual(env.calls.show, 0);
    assert.ok(env.timers.some(x => x.live && x.ms === 7000), "read-delay timer armed");
    assert.ok(!env.timers.some(x => x.live && x.ms === 8000), "fetch timeout timer cleared after success");
    await fireTimers(env, 7000); assert.strictEqual(env.calls.show, 1);
  });

  // ---------------- Exp 2B ----------------
  const LOOKUP = R("exp2/exp2_lookup.json");
  const TPL = n => R("exp2/templates/" + n + ".txt");
  const GENERIC_PREFIX = "The U.S. Bureau of Labor Statistics collects data on job loss";
  const PLACEBO_PREFIX = "We'd like you to think about how you get to work or run errands.";
  const FILES = { "exp2_lookup.json": LOOKUP, "templates/lede.txt": TPL("lede"), "templates/stat-churn.txt": TPL("stat-churn"), "templates/stat-decline.txt": TPL("stat-decline"), "templates/stat-generic.txt": TPL("stat-generic"), "templates/placebo.txt": TPL("placebo") };
  const fetcher = (failFile, mode) => (url) => {
    const f = url.replace("https://williammarble.com/social-ties-survey/exp2/", "");
    if (f === failFile) {
      if (mode === "404") return Promise.resolve(resp(404, ERR_BODY));
      if (mode === "reject") return Promise.reject(new TypeError("Failed to fetch"));
      if (mode === "hang") return HANG();
      if (mode === "badjson") return Promise.resolve(resp(200, "<html>not json ERRORBODY"));
    }
    return Promise.resolve(resp(200, FILES[f]));
  };
  async function runExp2b(arm, fetchImpl) {
    const env = fakeEnv({ fetchImpl, abort: true });
    prep(EXP2B, env.ctx, { "${e://Field/exp2b_arm}": arm, "${e://Field/resp_id}": "R_t", "${q://QID23/SelectedChoicesRecode}": "5", "${q://QID28/SelectedChoicesRecode}": "7" });
    env.ctx._onload.call(env.qThis); await flush(); await fireTimers(env, 100);   // drain reflect-prompt poller (<=50ms)
    return env;
  }
  const cases = [["threat", "exp2_lookup.json"], ["threat", "templates/lede.txt"], ["threat", "templates/stat-churn.txt"], ["threat", "templates/stat-decline.txt"], ["threat", "templates/stat-generic.txt"], ["placebo", "templates/placebo.txt"]];
  const modes = [["404", "http_404"], ["reject", "network"], ["hang", "timeout"]];
  for (const [arm, file] of cases) for (const [mode, want] of modes) {
    await t(`exp2b ${arm}: ${file} ${mode} -> exp2b_error=${want}, inline fallback, no error body`, async () => {
      const env = await runExp2b(arm, fetcher(file, mode));
      if (mode === "hang") { assert.ok(!env.ed.exp2b_error, "not failed before the timeout"); await fireTimers(env, 8000); }
      assert.strictEqual(env.ed.exp2b_error, want);
      assert.ok(env.ed.exp2b_text.indexOf(arm === "threat" ? GENERIC_PREFIX : PLACEBO_PREFIX) === 0, env.ed.exp2b_text.slice(0, 60));
      assert.ok(JSON.stringify(env.ed).indexOf("ERRORBODY") === -1 && env.ed.exp2b_text.indexOf("<") === -1);
      assert.strictEqual(env.ed.exp2b_frame, arm === "threat" ? "generic" : "placebo");
      assert.ok(env.els.exp2bDisplay.innerHTML.indexOf(arm === "threat" ? "Bureau of Labor" : "commute") !== -1);
    });
  }
  await t("exp2b threat: lookup 200 but not JSON -> exp2b_error=parse, generic fallback", async () => {
    const env = await runExp2b("threat", fetcher("exp2_lookup.json", "badjson"));
    assert.strictEqual(env.ed.exp2b_error, "parse"); assert.ok(env.ed.exp2b_text.indexOf(GENERIC_PREFIX) === 0);
  });
  for (const arm of ["threat", "placebo"]) await t(`exp2b ${arm}: all fetches ok -> real stimulus, no exp2b_error`, async () => {
    const env = await runExp2b(arm, fetcher(null, null));
    assert.ok(!("exp2b_error" in env.ed)); assert.ok(env.ed.exp2b_text.length > 50 && env.ed.exp2b_text.indexOf("[") === -1);
    assert.ok(!env.timers.some(x => x.live && x.ms === 8000), "timeout timers cleared");
  });

  console.log(`test-fetch-failures.js: all ${n} passed`);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
