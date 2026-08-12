// Dev tool — runs the GENERATED deployable scripts in a stubbed Qualtrics
// environment (node vm). This is the closest offline analog to a live run.
// Run: node test-hooks.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const S = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const TPL = v => fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "templates", v + ".txt"), "utf8");

function makeCtx(opts) {
  const ed = opts.embeddedData || {};
  const submitHandlers = [], loadHandlers = [];
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
    fetch: url => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(opts.templates[url.split("/").pop()] || ""),
      json: () => Promise.resolve({})
    }),
    Math, JSON, Promise, setTimeout
  };
  ctx.window = ctx;
  return { ctx, ed, submitHandlers, loadHandlers };
}

function span(text, domain) { return { textContent: text, getAttribute: () => domain }; }

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
  const { ctx, ed, submitHandlers } = makeCtx({ dom: { exp2aPrior: prior }, templates: {} });
  // the hook reads its own page's inputs via this.getQuestionContainer()
  const qThis = { getQuestionContainer: () => ({ querySelectorAll: () => ownInputs }) };
  vm.createContext(ctx);
  vm.runInContext(S("exp2a-parse.js"), ctx);
  assert.strictEqual(submitHandlers.length, 1, "parse hook registered");
  submitHandlers[0].call(qThis, "next");

  const det = JSON.parse(ed.exp2a_det_pairs);
  assert.strictEqual(det.length, 2, "two deterministic pairs (spouse excluded)");
  assert.strictEqual(ed.exp2a_needs_llm, "1", "residue triggers LLM");
  assert.ok(ed.exp2a_residue.indexOf("job: my ride or die") !== -1, "residue string");
  assert.strictEqual(ed.exp2a_llm_status, "", "status empty while WS pending");
  console.log("parse hook: ok");
}

// ---- 2. render hook, tie arm with LLM rescue -----------------------------
function runRender(edSeed, forceArm) {
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

{
  const det = JSON.stringify([
    { name: "Maria", rel: "sister", cls: "named_rel", domains: ["transport"], firstIndex: 0 },
    { name: "James", rel: "neighbor", cls: "named_rel", domains: ["money"], firstIndex: 6 }
  ]);
  const llm = JSON.stringify({ entries: [
    { text: "my ride or die", name: "Denise", relationship: "best friend", category: "friend", usable: true }
  ]});
  {
    const { ed, displayDiv } = runRender({
      exp2a_det_pairs: det, exp2a_llm_pairs: llm, exp2a_llm_status: "ok",
      exp2a_needs_llm: "1", exp2a_residue: "job: my ride or die"
    }, "tie");
    // wait a tick for the fetch .then chain
    setTimeout(() => {
      assert.strictEqual(ed.exp2a_arm, "tie");
      assert.strictEqual(ed.exp2a_variant, "named3");
      assert.strictEqual(ed.exp2a_n_names, "3");
      assert.strictEqual(ed.exp2a_parse_source, "det+llm");
      assert.ok(ed.exp2a_text.indexOf("Maria (your sister)") !== -1, "stimulus text");
      assert.ok(displayDiv.innerHTML.indexOf("Maria") !== -1, "rendered to DOM");
      console.log("render hook (tie, det+llm): ok");

      // ---- 3. LLM failed -> deterministic-only, still works --------------
      const r2 = runRender({
        exp2a_det_pairs: det, exp2a_llm_pairs: "", exp2a_llm_status: "",
        exp2a_needs_llm: "1", exp2a_residue: "job: my ride or die"
      }, "tie");
      setTimeout(() => {
        assert.strictEqual(r2.ed.exp2a_variant, "named2", "2 det pairs -> named2");
        assert.strictEqual(r2.ed.exp2a_parse_source, "llm_failed");
        console.log("render hook (tie, llm failed): ok");

        // ---- 4. placebo arm --------------------------------------------
        const r3 = runRender({ exp2a_det_pairs: det, exp2a_needs_llm: "0", exp2a_llm_status: "skipped" }, "placebo");
        setTimeout(() => {
          assert.strictEqual(r3.ed.exp2a_variant, "placebo");
          assert.ok(r3.ed.exp2a_text.indexOf("morning routine") !== -1);
          console.log("render hook (placebo): ok");
          console.log("test-hooks.js: all passed");
        }, 20);
      }, 20);
    }, 20);
  }
}
