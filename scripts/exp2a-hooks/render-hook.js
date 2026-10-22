/*
  EXP 2A render hook — paste target: the Exp 2A display question.
  Question HTML must contain:
      <div id="exp2aDisplay"></div>
      <div id="exp2aData" style="display:none"> holding three spans, whose ids
      are exp2a-det, exp2a-llm and exp2a-llmstatus, piped from the embedded-data
      fields exp2a_det_pairs, exp2a_llm_pairs and exp2a_llm_status (exact markup
      in exp2a-WIRING.md section 3).
  Respondent-derived text reaches this script ONLY via textContent of those
  spans — never via JS literals. exp2a_arm below is our own controlled value.
  Never put piped-text tokens in a comment: Qualtrics fills them there too, and a
  value containing the comment terminator would break the script
  (scripts/test-no-pipes-in-comments.js enforces).
  Next-question guard: the essay on the same page (QID77) is hidden until the
  stimulus has rendered or the fallback has been shown (10 s failsafe).
*/
Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;
  var BASE = "https://williammarble.com/social-ties-survey/exp2a/";
  var ARMS = ["tie", "placebo"];
  var ESSAY_QID = "QID77";          // the essay question on the same page as the stimulus
  var FETCH_TIMEOUT_MS = 8000;      // template fetch
  var ESSAY_FAILSAFE_MS = 10000;    // the essay is never hidden longer than this

  // ---- Hide the essay until the stimulus is on screen ----
  // Found by QID, else as the next .QuestionOuter after this question's own container.
  function hasClass(el, c) { return !!el && typeof el.className === "string" && (" " + el.className + " ").indexOf(" " + c + " ") !== -1; }
  function findEssay() {
    var el = document.getElementById(ESSAY_QID);
    if (el) { return el; }
    var node = null;
    try { node = qThis.getQuestionContainer(); } catch (e) { node = null; }
    while (node && !hasClass(node, "QuestionOuter")) { node = node.parentNode; }
    var sib = node ? node.nextElementSibling : null;
    while (sib && !hasClass(sib, "QuestionOuter")) { sib = sib.nextElementSibling; }
    return sib || null;
  }
  var essayEl = null;
  try { essayEl = findEssay(); } catch (e) { essayEl = null; }
  var essayRevealed = false;
  function revealEssay() {
    if (essayRevealed) { return; }
    essayRevealed = true;
    if (essayEl && essayEl.style) { essayEl.style.display = ""; }
  }
  if (essayEl && essayEl.style) { essayEl.style.display = "none"; }
  else { console.error("Exp2A: essay question not found; nothing hidden."); }
  setTimeout(revealEssay, ESSAY_FAILSAFE_MS);

  // fetch() resolves (does not reject) on HTTP 404/500 and can hang forever. getText rejects with
  // err.kind = "timeout" | "http_<status>" | "network". The timeout covers the body read.
  function getText(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = null;
      function fail(kind) { if (done) { return; } done = true; clearTimeout(timer); var e = new Error(kind); e.kind = kind; reject(e); }
      timer = setTimeout(function () {
        if (ctl) { try { ctl.abort(); } catch (x) { /* ignore */ } }
        fail("timeout");
      }, ms);
      fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
        if (!r.ok) { fail("http_" + r.status); return; }
        return r.text().then(function (t) { if (!done) { done = true; clearTimeout(timer); resolve(t); } });
      }).catch(function () { fail("network"); });
    });
  }

  function nodeText(id) {
    var el = document.getElementById(id);
    return el ? el.textContent : "";
  }

  // arm: reuse guard (exp2b pattern) — survives back/refresh
  var existing = "${e://Field/exp2a_arm}".trim();
  // >>> RNG BLOCK BEGIN (must be byte-identical in exp1-ad.js, exp2b-threat.js, exp2a-hooks/render-hook.js; scripts/test-rng.js enforces) >>>
  // Deterministic arm draw seeded from the respondent's ResponseID (ported from MediaGaza randomizer.js).
  /* FNV-1a 32-bit. Returns an unsigned 32-bit integer. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    var i;
    for (i = 0; i < str.length; i++) {
      h = h ^ str.charCodeAt(i);
      /* h * 16777619 without overflowing the float53 mantissa */
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  var imul = Math.imul || function (a, b) {
    var aHi = (a >>> 16) & 0xffff, aLo = a & 0xffff;
    var bHi = (b >>> 16) & 0xffff, bLo = b & 0xffff;
    return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
  };
  /* mulberry32: small, fast, adequate for treatment assignment. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = imul(t ^ (t >>> 15), t | 1);
      t = t ^ (t + imul(t ^ (t >>> 7), t | 61));
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var RAND_VERSION = "1";
  /* Pure: same (salt, respId) always gives the same arm. First draw only. */
  function drawArm(arms, salt, respId) {
    var rng = mulberry32(fnv1a(salt + ":" + respId));
    return arms[Math.floor(rng() * arms.length)];
  }
  /* Empty or unreplaced-pipe ids (start with a dollar sign) fall back to an unseeded seed. */
  function drawArmWithFallback(arms, salt, rawId) {
    var id = String(rawId === null || rawId === undefined ? "" : rawId).trim();
    var fallback = false;
    if (id === "" || id.charAt(0) === "$") {
      id = Date.now() + ":" + Math.random();
      fallback = true;
    }
    return { arm: drawArm(arms, salt, id), fallback: fallback };
  }
  // <<< RNG BLOCK END <<<
  var respId = "${e://Field/resp_id}".trim();
  var arm;
  if (ARMS.indexOf(existing) !== -1) { arm = existing; }
  else {
    var draw = drawArmWithFallback(ARMS, "exp2a", respId);
    arm = draw.arm;
    if (draw.fallback) {
      Qualtrics.SurveyEngine.setEmbeddedData("rng_seed_fallback", "1");
      console.log("Exp2A: resp_id missing/unreplaced; used fallback seed");
    }
  }
  Qualtrics.SurveyEngine.setEmbeddedData("rand_version", RAND_VERSION);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_arm", arm);

  // merge det + llm (both defensive), select, decide variant
  var detPairs = [];
  try { detPairs = JSON.parse(nodeText("exp2a-det") || "[]"); } catch (e) { detPairs = []; }
  if (Object.prototype.toString.call(detPairs) !== "[object Array]") { detPairs = []; }
  // Defensive: drop non-object entries; entries without a usable domains array get [].
  detPairs = detPairs.filter(function (p) { return p && typeof p === "object"; }).map(function (p) {
    if (Object.prototype.toString.call(p.domains) !== "[object Array]") { p.domains = []; }
    return p;
  });
  var llmStatus = nodeText("exp2a-llmstatus").trim();
  var needsLlm = llmStatus !== "skipped";
  var pairs = detPairs;
  var source = "det";
  if (needsLlm) {
    // "message" is Anthropic's response type on success (the Web Service maps it into exp2a_llm_status); "ok" kept for the old mapping.
    if (llmStatus === "ok" || llmStatus === "message") {
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
    try {
    if (target) {
      target.innerHTML = composed.split(/\n\s*\n/)
        .filter(function (p) { return p.trim() !== ""; })
        .map(function (p) { return '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>"; })
        .join("");
    }
    } finally { revealEssay(); }
    console.log("Exp2A arm:", arm, "variant:", dv.variant, "n:", pairs.length, "source:", source);
  }

  // Inline fallbacks are byte-identical to tie-generic.txt / placebo.txt so a
  // transient fetch failure cannot hand out a different stimulus class (2B rule).
  var FALLBACK_GENERIC = "Imagine you moved to a new area about four hours away for a job opportunity. You don't know anyone there — no family nearby, no close friends, no neighbors you can count on. The people you'd normally turn to for help are all back where you used to live.\n\nIn a few sentences, describe how your daily life might be different without anyone nearby that you could rely on. What kinds of things would you have to handle differently?";
  var FALLBACK_PLACEBO = "We'd like you to think about your daily routine. Imagine a typical weekday for you — from when you wake up to when you go to sleep.\n\nNow, imagine that you rearranged your morning routine — say, you started waking up an hour earlier than usual and changed the order in which you do things.\n\nIn a few sentences, how do you think your day would feel different?";

  var file = { named3: "tie-named-3.txt", named2: "tie-named-2.txt", generic: "tie-generic.txt", placebo: "placebo.txt" }[dv.variant];
  getText(BASE + "templates/" + file, FETCH_TIMEOUT_MS)
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
      var reason = (e && e.kind) ? e.kind : "error";
      console.error("Exp2A template fetch failed:", reason, e);
      Qualtrics.SurveyEngine.setEmbeddedData("exp2a_error", reason);
      if (arm === "placebo") { show(FALLBACK_PLACEBO); }
      else {
        dv = { variant: "generic", lowTie: dv.lowTie };
        Qualtrics.SurveyEngine.setEmbeddedData("exp2a_variant", "generic");
        show(FALLBACK_GENERIC);
      }
    });
});
