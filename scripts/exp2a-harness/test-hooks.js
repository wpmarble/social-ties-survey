// Dev tool — runs the GENERATED deployable scripts in a stubbed Qualtrics
// environment (node vm). This is the closest offline analog to a live run.
// Run: node test-hooks.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const S = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const TPL = v => fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "templates", v + ".txt"), "utf8");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeCtx(opts) {
  const ed = opts.embeddedData || {};
  const submitHandlers = [], loadHandlers = [];
  const fetchMode = opts.fetchMode || "ok"; // "ok" | "reject" | "notok"
  const ctx = {
    console,
    Qualtrics: { SurveyEngine: {
      addOnload: f => loadHandlers.push(f),
      addOnReady: () => {},
      addOnUnload: () => {},
      addOnPageSubmit: f => submitHandlers.push(f),
      setEmbeddedData: (k, v) => { ed[k] = String(v); }
    }},
    document: {
      getElementById: id => opts.dom[id] || null,
      querySelectorAll: () => []
    },
    fetch: url => {
      // I6(a)/(b): stub can simulate a rejected fetch (network failure) or a
      // resolved-but-not-ok response (HTTP 404/500) — both must be exercised
      // since fetch() only rejects on true network failure, never on HTTP
      // error status (that's what C1 fixed in the .then chain).
      if (fetchMode === "reject") { return Promise.reject(new Error("simulated network failure")); }
      if (fetchMode === "notok") {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("<html><body>Internal Server Error</body></html>"),
          json: () => Promise.resolve({})
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(opts.templates[url.split("/").pop()] || ""),
        json: () => Promise.resolve({})
      });
    },
    Math, JSON, Promise, setTimeout
  };
  ctx.window = ctx;
  return { ctx, ed, submitHandlers, loadHandlers };
}

function span(text, domain) { return { textContent: text, getAttribute: () => domain }; }

function runRender(edSeed, forceArm, extra) {
  extra = extra || {};
  const det = edSeed.exp2a_det_pairs || "";
  const llm = edSeed.exp2a_llm_pairs || "";
  const status = edSeed.exp2a_llm_status || "";
  const displayDiv = { innerHTML: "" };
  const dom = {
    exp2aDisplay: displayDiv,
    "exp2a-det": { textContent: det },
    "exp2a-llm": { textContent: llm },
    "exp2a-llmstatus": { textContent: status }
  };
  const { ctx, ed, loadHandlers } = makeCtx({
    embeddedData: edSeed,
    dom,
    fetchMode: extra.fetchMode,
    templates: {
      "tie-named-3.txt": TPL("tie-named-3"), "tie-named-2.txt": TPL("tie-named-2"),
      "tie-generic.txt": TPL("tie-generic"), "placebo.txt": TPL("placebo")
    }
  });
  vm.createContext(ctx);
  // the generated render script reads ${e://Field/exp2a_arm} into EXISTING_ARM
  // at paste time; the build step leaves it as a pipe. For the vm test we
  // substitute before eval, mimicking Qualtrics server-side piping:
  let src = S("exp2a-render.js").split("${e://Field/exp2a_arm}").join(forceArm || "");
  vm.runInContext(src, ctx);
  const qThis = { getQuestionContainer: () => ({ querySelectorAll: () => [] }) };
  loadHandlers.forEach(f => f.call(qThis));
  return { ed, displayDiv };
}

async function main() {
  // ---- 1. parse hook end-to-end -------------------------------------------
  {
    const prior = {
      querySelectorAll: () => [
        span("Maria — sister", "transport"), span("", "transport"), span("", "transport"),
        span("my ride or die", "job"), span("", "job"), span("", "job"),
        span("James, neighbor", "money"), span("", "money"), span("", "money")
      ]
    };
    const ownInputs = [{ value: "my wife" }, { value: "" }, { value: "" }];
    const { ctx, ed, submitHandlers, loadHandlers } = makeCtx({ dom: { exp2aPrior: prior }, templates: {} });
    // the hook reads its own page's inputs via this.getQuestionContainer(),
    // captured from addOnload's `this` (I2: addOnPageSubmit's `this` is not a
    // documented guarantee, so registration now happens inside addOnload).
    const qThis = { getQuestionContainer: () => ({ querySelectorAll: () => ownInputs }) };
    vm.createContext(ctx);
    vm.runInContext(S("exp2a-parse.js"), ctx);
    assert.strictEqual(loadHandlers.length, 1, "parse hook registers via addOnload (I2)");
    assert.strictEqual(submitHandlers.length, 0, "addOnPageSubmit not registered until onload runs");
    loadHandlers[0].call(qThis);
    assert.strictEqual(submitHandlers.length, 1, "parse hook's addOnPageSubmit registered inside onload");
    submitHandlers[0]("next"); // no `this` needed here — qThis was captured by the closure at onload time

    const det = JSON.parse(ed.exp2a_det_pairs);
    assert.strictEqual(det.length, 2, "two deterministic pairs (spouse excluded)");
    assert.strictEqual(ed.exp2a_needs_llm, "1", "residue triggers LLM");
    assert.ok(ed.exp2a_residue.indexOf("job: my ride or die") !== -1, "residue string");
    assert.strictEqual(ed.exp2a_llm_status, "", "status empty while WS pending");
    console.log("parse hook: ok");
  }

  const det = JSON.stringify([
    { name: "Maria", rel: "sister", cls: "named_rel", domains: ["transport"], firstIndex: 0 },
    { name: "James", rel: "neighbor", cls: "named_rel", domains: ["money"], firstIndex: 6 }
  ]);
  const llm = JSON.stringify({ entries: [
    { text: "my ride or die", name: "Denise", relationship: "best friend", category: "friend", usable: true }
  ]});

  // ---- 2. render hook, tie arm with LLM rescue -----------------------------
  {
    const { ed, displayDiv } = runRender({
      exp2a_det_pairs: det, exp2a_llm_pairs: llm, exp2a_llm_status: "ok",
      exp2a_needs_llm: "1", exp2a_residue: "job: my ride or die"
    }, "tie");
    await wait(20); // let the fetch .then chain settle
    assert.strictEqual(ed.exp2a_arm, "tie");
    assert.strictEqual(ed.exp2a_variant, "named3");
    assert.strictEqual(ed.exp2a_n_names, "3");
    assert.strictEqual(ed.exp2a_parse_source, "det+llm");
    assert.ok(ed.exp2a_text.indexOf("Maria (your sister)") !== -1, "stimulus text");
    assert.ok(displayDiv.innerHTML.indexOf("Maria") !== -1, "rendered to DOM");
    console.log("render hook (tie, det+llm): ok");
  }

  // ---- 3. LLM failed -> deterministic-only, still works --------------------
  {
    const r2 = runRender({
      exp2a_det_pairs: det, exp2a_llm_pairs: "", exp2a_llm_status: "",
      exp2a_needs_llm: "1", exp2a_residue: "job: my ride or die"
    }, "tie");
    await wait(20);
    assert.strictEqual(r2.ed.exp2a_variant, "named2", "2 det pairs -> named2");
    assert.strictEqual(r2.ed.exp2a_parse_source, "llm_failed");
    console.log("render hook (tie, llm failed): ok");
  }

  // ---- 4. placebo arm --------------------------------------------------------
  {
    const r3 = runRender({ exp2a_det_pairs: det, exp2a_needs_llm: "0", exp2a_llm_status: "skipped" }, "placebo");
    await wait(20);
    assert.strictEqual(r3.ed.exp2a_variant, "placebo");
    assert.ok(r3.ed.exp2a_text.indexOf("morning routine") !== -1);
    console.log("render hook (placebo): ok");
  }

  // ---- 5. I6(a): fetch REJECTS -> inline fallback, forced to generic -------
  {
    const r4 = runRender({
      exp2a_det_pairs: det, exp2a_llm_pairs: llm, exp2a_llm_status: "ok", exp2a_needs_llm: "1"
    }, "tie", { fetchMode: "reject" });
    await wait(20);
    assert.strictEqual(r4.ed.exp2a_variant, "generic", "fetch reject -> forced to generic (tie arm)");
    assert.strictEqual(r4.ed.exp2a_text, TPL("tie-generic").trim(),
      "fetch reject -> inline fallback byte-identical to tie-generic.txt");
    assert.ok(r4.displayDiv.innerHTML.indexOf("moved to a new area") !== -1, "fallback rendered to DOM");
    console.log("render hook (tie, fetch rejects): ok");
  }

  // ---- 6. I6(b): fetch resolves ok:false -> same fallback outcome (C1) -----
  {
    const r5 = runRender({
      exp2a_det_pairs: det, exp2a_llm_pairs: llm, exp2a_llm_status: "ok", exp2a_needs_llm: "1"
    }, "tie", { fetchMode: "notok" });
    await wait(20);
    assert.strictEqual(r5.ed.exp2a_variant, "generic", "fetch !ok -> forced to generic (tie arm)");
    assert.strictEqual(r5.ed.exp2a_text, TPL("tie-generic").trim(),
      "fetch !ok -> inline fallback byte-identical to tie-generic.txt (exercises C1)");
    console.log("render hook (tie, fetch resolves ok:false): ok");
  }

  // ---- 7. I6(c): det span empty (parse hook never ran) -> must not throw ---
  {
    let r6, threw = null;
    try {
      r6 = runRender({
        exp2a_det_pairs: "", exp2a_llm_pairs: "", exp2a_llm_status: "", exp2a_needs_llm: ""
      }, "tie");
    } catch (e) { threw = e; }
    assert.strictEqual(threw, null, "renderer must not throw when det span is empty (parse hook never ran)");
    await wait(20);
    assert.strictEqual(r6.ed.exp2a_variant, "generic", "no pairs available -> generic (tie arm)");
    console.log("render hook (tie, empty det span / parse hook never ran): ok");
  }

  // ---- 8. I6(d): fallback literals byte-identical to template files --------
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "exp2a-hooks", "render-hook.js"), "utf8");
    function extractLiteral(varName) {
      const re = new RegExp(varName + "\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\")");
      const m = src.match(re);
      assert.ok(m, `${varName} literal not found in render-hook.js`);
      return JSON.parse(m[1]);
    }
    const generic = extractLiteral("FALLBACK_GENERIC");
    const placebo = extractLiteral("FALLBACK_PLACEBO");
    assert.strictEqual(generic, TPL("tie-generic").trim(),
      "FALLBACK_GENERIC must be byte-identical to trimmed tie-generic.txt");
    assert.strictEqual(placebo, TPL("placebo").trim(),
      "FALLBACK_PLACEBO must be byte-identical to trimmed placebo.txt");
    console.log("fallback byte-identity (I6d): ok");
  }

  console.log("test-hooks.js: all passed");
}

main().catch(e => { console.error(e); process.exit(1); });
