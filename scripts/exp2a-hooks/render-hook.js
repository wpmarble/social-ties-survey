/*
  EXP 2A render hook — paste target: the Exp 2A display question.
  Question HTML must contain:
      <div id="exp2aDisplay"></div>
      <div id="exp2aData" style="display:none">
        <span id="exp2a-det">${e://Field/exp2a_det_pairs}</span>
        <span id="exp2a-llm">${e://Field/exp2a_llm_pairs}</span>
        <span id="exp2a-llmstatus">${e://Field/exp2a_llm_status}</span>
      </div>
  Respondent-derived text reaches this script ONLY via textContent of those
  spans — never via JS literals. exp2a_arm below is our own controlled value.
*/
Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;
  var BASE = "https://williammarble.com/social-ties-survey/exp2a/";
  var ARMS = ["tie", "placebo"];

  function nodeText(id) {
    var el = document.getElementById(id);
    return el ? el.textContent : "";
  }

  // arm: reuse guard (exp2b pattern) — survives back/refresh
  var existing = "${e://Field/exp2a_arm}".trim();
  var arm = ARMS.indexOf(existing) !== -1 ? existing : ARMS[Math.floor(Math.random() * ARMS.length)];
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_arm", arm);

  // merge det + llm (both defensive), select, decide variant
  var detPairs = [];
  try { detPairs = JSON.parse(nodeText("exp2a-det") || "[]"); } catch (e) { detPairs = []; }
  if (Object.prototype.toString.call(detPairs) !== "[object Array]") { detPairs = []; }
  var llmStatus = nodeText("exp2a-llmstatus").trim();
  var needsLlm = llmStatus !== "skipped";
  var pairs = detPairs;
  var source = "det";
  if (needsLlm) {
    if (llmStatus === "ok") {
      pairs = EXP2A.mergeLlm(detPairs, nodeText("exp2a-llm"), []);
      source = "det+llm";
    } else {
      source = "llm_failed";
    }
  }
  var selected = EXP2A.selectPairs(pairs, 3);
  var dv = EXP2A.decideVariant(arm, pairs.length);

  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_variant", dv.variant);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_n_names", String(pairs.length));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_low_tie_flag", String(dv.lowTie));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_parse_source", source);
  for (var k = 0; k < 3; k++) {
    var used = (dv.variant === "named3" && k < 3) || (dv.variant === "named2" && k < 2);
    var p = used ? selected[k] : null;
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_name" + (k + 1), p ? (p.name || "your " + p.rel) : "");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_rel" + (k + 1), p ? (p.rel || "") : "");
  }

  var target = document.getElementById("exp2aDisplay");
  if (target) { target.innerHTML = '<p style="color:#888;">Loading…</p>'; }
  else { console.error("Exp2A: #exp2aDisplay missing — data stored, nothing rendered."); }

  function show(text) {
    var sel = (dv.variant === "named3") ? selected.slice(0, 3)
            : (dv.variant === "named2") ? selected.slice(0, 2) : [];
    var composed = EXP2A.composeStimulus(text.trim(), sel);
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_reflect_clause", EXP2A.reflectClause(sel));
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_text", composed);
    if (target) {
      target.innerHTML = composed.split(/\n\s*\n/)
        .filter(function (p) { return p.trim() !== ""; })
        .map(function (p) { return '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>"; })
        .join("");
    }
    console.log("Exp2A arm:", arm, "variant:", dv.variant, "n:", pairs.length, "source:", source);
  }

  // Inline fallbacks are byte-identical to tie-generic.txt / placebo.txt so a
  // transient fetch failure cannot hand out a different stimulus class (2B rule).
  var FALLBACK_GENERIC = "Imagine you moved to a new area about four hours away for a job opportunity. You don't know anyone there — no family nearby, no close friends, no neighbors you can count on. The people you'd normally turn to for help are all back where you used to live.\n\nIn a few sentences, describe how your daily life might be different without anyone nearby that you could rely on. What kinds of things would you have to handle differently?";
  var FALLBACK_PLACEBO = "We'd like you to think about your daily routine. Imagine a typical weekday for you — from when you wake up to when you go to sleep.\n\nNow, imagine that you rearranged your morning routine — say, you started waking up an hour earlier than usual and changed the order in which you do things.\n\nIn a few sentences, how do you think your day would feel different?";

  var file = { named3: "tie-named-3.txt", named2: "tie-named-2.txt", generic: "tie-generic.txt", placebo: "placebo.txt" }[dv.variant];
  fetch(BASE + "templates/" + file)
    .then(function (r) {
      // fetch() resolves (does not reject) on HTTP 404/500 — without this
      // check the error page body would flow into show() as the stimulus.
      if (!r.ok) { throw new Error("HTTP " + r.status); }
      return r.text();
    })
    .then(function (t) {
      // Defense in depth: an unexpected 200 with HTML (misconfigured host,
      // captive portal, moved page) or a template missing its placeholder
      // token is not a usable stimulus either — force the catch/fallback.
      if (t.indexOf("<") !== -1) { throw new Error("Exp2A: fetched template contains '<'"); }
      if ((dv.variant === "named3" || dv.variant === "named2") && t.indexOf("[NAME1]") === -1) {
        throw new Error("Exp2A: fetched template missing [NAME1]");
      }
      show(t);
    })
    .catch(function (e) {
      console.error("Exp2A template fetch failed:", e);
      if (arm === "placebo") { show(FALLBACK_PLACEBO); }
      else {
        dv = { variant: "generic", lowTie: dv.lowTie };
        Qualtrics.SurveyEngine.setEmbeddedData("exp2a_variant", "generic");
        show(FALLBACK_GENERIC);
      }
    });
});
