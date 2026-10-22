Qualtrics.SurveyEngine.addOnload(function() {

  /*
    EXPERIMENT 2B — economic threat prime.
    Place on the Exp 2B question. Its HTML must contain:
        <div id="exp2bDisplay"></div>

    Randomizes threat vs placebo, looks up the respondent's industry x
    occupation cell, composes the stimulus from hosted templates, renders it,
    and stores what was shown. All routing logic lives in build_exp2_lookup.R —
    this script applies none.
  */

  var qThis = this;

  const BASE = "https://williammarble.com/social-ties-survey/exp2/";
  const ARMS = ["threat", "placebo"];

  // Answer codes from the Background - Work block (QID23 / QID28).
  function code(raw, max) {
    const n = parseInt(String(raw).trim(), 10);
    if (isNaN(n) || n < 1 || n > max) { return 0; }
    return n;
  }
  var indCode = code("${q://QID23/SelectedChoicesRecode}", 21);
  var occCode = code("${q://QID28/SelectedChoicesRecode}", 23);

  // Reuse an existing assignment (guards re-randomizing on back/refresh).
  var existing = "${e://Field/exp2b_arm}".trim();
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

  // Seeded from resp_id (salt "exp2b").
  var respId = "${e://Field/resp_id}".trim();
  var arm;
  if (ARMS.indexOf(existing) !== -1) { arm = existing; }
  else {
    var draw = drawArmWithFallback(ARMS, "exp2b", respId);
    arm = draw.arm;
    if (draw.fallback) {
      Qualtrics.SurveyEngine.setEmbeddedData("rng_seed_fallback", "1");
      console.log("Exp2B: resp_id missing/unreplaced; used fallback seed");
    }
  }
  Qualtrics.SurveyEngine.setEmbeddedData("rand_version", RAND_VERSION);

  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_arm", arm);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_ind_code", String(indCode));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_occ_code", String(occCode));
  console.log("Exp2B arm:", arm, "ind:", indCode, "occ:", occCode);

  // ---- Arm-specific reflection prompt (QID76) -------------------------------
  // QID76 sits on THIS page, after the stimulus, so a piped embedded-data value would not resolve.
  // Its question text is <span id="exp2bReflectPrompt">neutral fallback</span>; we overwrite the span's text
  // for the arm. QID76 may render after this onload fires, so poll for the span (up to 40 x 50 ms = 2 s).
  // If it never appears the neutral fallback stays and exp2b_reflect_prompt = "fallback".
  var REFLECT_PROMPTS = {
    threat: "Take a moment to think about this. In a few sentences, what would be on your mind about your work and your finances if you were in this situation?",
    placebo: "Take a moment to think about this. In a few sentences, what would be on your mind as you get to work or run errands?"
  };
  (function setReflectPrompt(promptText) {
    var tries = 0;
    function tick() {
      var el = document.getElementById("exp2bReflectPrompt");
      if (el) {
        el.textContent = promptText;
        Qualtrics.SurveyEngine.setEmbeddedData("exp2b_reflect_prompt", promptText);
        console.log("Exp2B reflect prompt set for arm:", arm);
      } else if (++tries >= 40) {
        console.error("Exp2B: #exp2bReflectPrompt never appeared; neutral fallback prompt left in place.");
        Qualtrics.SurveyEngine.setEmbeddedData("exp2b_reflect_prompt", "fallback");
      } else {
        setTimeout(tick, 50);
      }
    }
    tick();
  })(REFLECT_PROMPTS[arm]);

  var target = document.getElementById("exp2bDisplay");
  if (target) { target.innerHTML = '<p style="color:#888;">Loading…</p>'; }
  else { console.error("Exp2B: #exp2bDisplay not found in the DOM — embedded data will still be stored, but nothing will render on screen. Check the question HTML."); }

  function render(text, frame, cell) {
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_text", text);
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_frame", frame);
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_churn_pct",    cell.churn_pct    || "");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_decline_pct",  cell.decline_pct  || "");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_churn_unit",   cell.churn_unit   || "");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_decline_unit", cell.decline_unit || "");
    if (target) {
      target.innerHTML = text.split(/\n\s*\n/)
        .filter(p => p.trim() !== "")
        .map(p => '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>")
        .join("");
    } else {
      console.error("Exp2B: #exp2bDisplay not found in the DOM — stimulus text was composed and embedded data was stored, but nothing was rendered on screen for this respondent.");
    }
    console.log("Exp2B frame:", frame, "\n", text);
  }

  const EMPTY = { churn_pct: "", decline_pct: "", churn_unit: "", decline_unit: "" };

  // ---- Fetch with timeout + HTTP check ----
  // fetch() resolves (does not reject) on HTTP 404/500, and can hang forever. getT rejects with err.kind =
  // "timeout" | "http_<status>" | "network" | "parse" (body not valid JSON). The timeout covers the body read.
  var FETCH_TIMEOUT_MS = 8000;
  function getT(url, ms, asJson) {
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
        return r.text().then(function (t) {
          if (done) { return; }
          var v = t;
          if (asJson) { try { v = JSON.parse(t); } catch (x) { fail("parse"); return; } }
          done = true; clearTimeout(timer); resolve(v);
        });
      }).catch(function () { fail("network"); });
    });
  }

  // Failure path: record why, and render the inline text (never fetched HTML, never an error body).
  function reasonOf(e) { return (e && e.kind) ? e.kind : "error"; }

  // Placebo needs one file and no lookup.
  if (arm === "placebo") {
    getT(BASE + "templates/placebo.txt", FETCH_TIMEOUT_MS, false)
      .then(t => { render(t.trim(), "placebo", EMPTY); })
      .catch(e => {
        console.error("Exp2B placebo fetch failed:", reasonOf(e), e);
        Qualtrics.SurveyEngine.setEmbeddedData("exp2b_error", reasonOf(e));
        render("We'd like you to think about how you get to work or run errands. " +
               "Consider your typical commute or grocery run.", "placebo", EMPTY);
      });
    return;
  }

  // Threat arm: lookup + templates together (parallel, so the worst case is one timeout, not five).
  Promise.all([
    getT(BASE + "exp2_lookup.json", FETCH_TIMEOUT_MS, true),
    getT(BASE + "templates/lede.txt", FETCH_TIMEOUT_MS, false),
    getT(BASE + "templates/stat-churn.txt", FETCH_TIMEOUT_MS, false),
    getT(BASE + "templates/stat-decline.txt", FETCH_TIMEOUT_MS, false),
    getT(BASE + "templates/stat-generic.txt", FETCH_TIMEOUT_MS, false)
  ]).then(function(res) {
    const lookup = res[0];
    const lede = res[1].trim(), churn = res[2].trim();
    const decline = res[3].trim(), generic = res[4].trim();

    // Both codes present: exact cell. One missing/invalid: fall back onto the
    // "Other" row for the missing axis (occ 23 / ind 21) rather than
    // discarding a perfectly good statistic on the axis that IS known —
    // those rows are already resolved by build_exp2_lookup.R, so this is a
    // lookup substitution, not routing logic. Both missing: generic.
    var cell = null;
    if (indCode > 0 && occCode > 0 && lookup[String(indCode)]) {
      cell = lookup[String(indCode)][String(occCode)];
    } else if (indCode > 0 && lookup[String(indCode)]) {
      cell = lookup[String(indCode)]["23"];
    } else if (occCode > 0 && lookup["21"]) {
      cell = lookup["21"][String(occCode)];
    }
    if (!cell) { cell = { frame: "generic", churn_pct: "", decline_pct: "",
                          churn_unit: "", decline_unit: "", churn_clause: "" }; }

    const parts = [lede];
    if (cell.frame === "generic") { parts.push(generic); }
    else {
      if (cell.frame.indexOf("churn") !== -1)   { parts.push(churn); }
      if (cell.frame.indexOf("decline") !== -1) { parts.push(decline); }
    }
    const text = parts.join("\n\n")
      .replace(/\[CHURN_UNIT\]/g,   cell.churn_unit)
      .replace(/\[CHURN_PCT\]/g,    cell.churn_pct)
      .replace(/\[CHURN_CLAUSE\]/g, cell.churn_clause)
      .replace(/\[DECLINE_UNIT\]/g, cell.decline_unit)
      .replace(/\[DECLINE_PCT\]/g,  cell.decline_pct);

    render(text, cell.frame, cell);
  }).catch(function(e) {
    console.error("Exp2B fetch failed:", reasonOf(e), e);
    Qualtrics.SurveyEngine.setEmbeddedData("exp2b_error", reasonOf(e));
    // Must match the real "generic" composition exactly (lede + generic
    // sentence, joined by a blank line) so a transient fetch failure doesn't
    // silently hand this respondent a shorter, less authoritative stimulus
    // than the real generic-frame group gets. Inline string literals only —
    // no second fetch attempt from a catch path.
    render("The U.S. Bureau of Labor Statistics collects data on job loss and " +
           "projects how employment will change in the years ahead.\n\n" +
           "Imagine you found out your workplace was planning significant layoffs " +
           "in the coming months, and your own job might be at risk.", "generic", EMPTY);
  });

});
