Qualtrics.SurveyEngine.addOnload(function() {

  /*
    EXPERIMENT 1 — candidate-ad randomizer + renderer.
    Place on the treatment/ad question. Its HTML must contain:
        <div id="adDisplay"></div>

    On load:
      (a) randomizes one of 4 arms (equal allocation)
      (b) stores arm + candidate fields + assembled ad as embedded data
      (c) fetches the arm's text, fills the [CANDIDATE NAME] / [CANDIDATE LAST NAME] / [STATE] placeholders
      (d) renders it into #adDisplay as a sponsored-post ad card
      (e) holds the Next button for READ_DELAY_MS after the ad appears

    The card chrome (avatar, name, "Sponsored", accent) is identical across all
    arms — only the body copy changes — so styling is not a treatment confound.
  */

  var qThis = this;

  // ---- Config ----
  const BASE_URL = "https://williammarble.com/social-ties-survey/exp1/";
  const ARMS = ["anti-baseline", "anti-fiscal", "anti-crowdout", "control-valence"];
  const CANDIDATE_NAME = "Mark Anderson";
  const CANDIDATE_LAST = "Anderson";
  const CANDIDATE_PAGE = "Mark Anderson for Senate"; // shown as the ad's page name
  const AVATAR_URL = BASE_URL + "politician-stock-photo.jpg";
  const READ_DELAY_MS = 7000; // reading window after the ad renders

  const GLOBE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"></path></svg>';

  // Names that need a leading article in running text ("grew up in the District of Columbia").
  var STATE_NEEDS_THE = { "District of Columbia": 1, "U.S. Virgin Islands": 1, "Northern Mariana Islands": 1 };

  // Respondent's state, filled from earlier in the survey. Falls back if empty.
  var respState = "${e://Field/resp_state}".trim();
  if (respState === "" || respState.indexOf("e://Field") !== -1) {
    respState = "your state";
  } else if (Object.prototype.hasOwnProperty.call(STATE_NEEDS_THE, respState)) {
    respState = "the " + respState;   // exact match only: "the District of Columbia", not "the Ohio"
  }

  // Reuse an existing assignment if present (guards re-randomizing on back/refresh).
  var existingArm = "${e://Field/exp1_tr_arm}".trim();

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

  // ---- Choose arm (seeded from resp_id; salt "exp1") ----
  var respId = "${e://Field/resp_id}".trim();
  var arm;
  if (existingArm !== "" && ARMS.indexOf(existingArm) !== -1) {
    arm = existingArm;
  } else {
    var draw = drawArmWithFallback(ARMS, "exp1", respId);
    arm = draw.arm;
    if (draw.fallback) {
      Qualtrics.SurveyEngine.setEmbeddedData("rng_seed_fallback", "1");
      console.log("Exp1: resp_id missing/unreplaced; used fallback seed");
    }
  }
  Qualtrics.SurveyEngine.setEmbeddedData("rand_version", RAND_VERSION);
  console.log("Exp1 arm:", arm);

  // ---- Store assignment + candidate fields ----
  Qualtrics.SurveyEngine.setEmbeddedData("exp1_tr_arm", arm);
  Qualtrics.SurveyEngine.setEmbeddedData("exp1_candidate_name", CANDIDATE_NAME);
  Qualtrics.SurveyEngine.setEmbeddedData("exp1_candidate_last", CANDIDATE_LAST);

  // ---- Inject the ad-card styles once ----
  injectExp1Styles();

  // ---- Hold Next until the ad is on screen; show a placeholder ----
  qThis.hideNextButton();
  var target = document.getElementById("adDisplay");
  if (target) {
    target.innerHTML = '<p style="text-align:center; color:#888; padding:24px;">Loading…</p>';
  }

  // ---- Fetch with timeout + HTTP check ----
  // fetch() resolves (does not reject) on HTTP 404/500, and can hang forever. getText rejects with err.kind =
  // "timeout" | "http_<status>" | "network" so the failure path below can record why. The timeout covers the body read.
  var FETCH_TIMEOUT_MS = 8000;
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

  // ---- Fetch, fill, store, render ----
  getText(BASE_URL + arm + ".txt", FETCH_TIMEOUT_MS)
    .then(raw => {
      const filled = raw
        .replace(/\[CANDIDATE NAME\]/gi, CANDIDATE_NAME)
        .replace(/\[CANDIDATE LAST NAME\]/gi, CANDIDATE_LAST)
        .replace(/\[STATE\]/gi, respState);

      Qualtrics.SurveyEngine.setEmbeddedData("exp1_treatment_text", filled);
      console.log("Exp1 assembled ad:\n", filled);

      // Body paragraphs; the last block renders as a muted ad disclaimer.
      const paras = filled.split(/\n\s*\n/).filter(p => p.trim() !== "");
      const bodyHtml = paras
        .map((p, i) => {
          const cls = (i === paras.length - 1) ? "exp1-ad-p exp1-ad-disclaimer" : "exp1-ad-p";
          return '<p class="' + cls + '">' + p.trim().replace(/\n/g, " ") + "</p>";
        })
        .join("");

      const cardHtml =
        '<div class="exp1-ad-canvas">' +
          '<div class="exp1-ad-card">' +
            '<div class="exp1-ad-accent"></div>' +
            '<div class="exp1-ad-head">' +
              '<img class="exp1-ad-avatar" src="' + AVATAR_URL + '" alt="' + CANDIDATE_NAME + '">' +
              '<div class="exp1-ad-id">' +
                '<div class="exp1-ad-name">' + CANDIDATE_PAGE + '</div>' +
                '<div class="exp1-ad-meta"><span>Sponsored</span><span aria-hidden="true">·</span>' + GLOBE_SVG + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="exp1-ad-body">' + bodyHtml + '</div>' +
          '</div>' +
        '</div>';

      if (target) {
        target.innerHTML = cardHtml;
      }

      setTimeout(() => { qThis.showNextButton(); }, READ_DELAY_MS);
    })
    .catch(error => {
      // Record why; the ad card stays empty and the error body is never stored as treatment text.
      var reason = (error && error.kind) ? error.kind : "error";
      console.error("Exp1: failed to load ad text:", reason, error);
      Qualtrics.SurveyEngine.setEmbeddedData("exp1_error", reason);
      Qualtrics.SurveyEngine.setEmbeddedData("exp1_treatment_text", "");
      if (target) { target.innerHTML = ""; }
      qThis.showNextButton();
    });

  // ---- Styles (injected once; class names prefixed to avoid Qualtrics collisions) ----
  function injectExp1Styles() {
    if (document.getElementById("exp1-ad-styles")) { return; }
    var css = [
      '.exp1-ad-canvas{background:#EDEFF2;padding:24px 16px;display:flex;justify-content:center;box-sizing:border-box;}',
      '.exp1-ad-card{width:100%;max-width:500px;background:#FFFFFF;border:1px solid #E2E6EB;border-radius:12px;box-shadow:0 1px 3px rgba(18,40,76,.10),0 8px 24px rgba(18,40,76,.06);overflow:hidden;text-align:left;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',
      '.exp1-ad-accent{height:3px;background:#C4262E;}',
      '.exp1-ad-head{display:flex;align-items:center;gap:12px;padding:14px 16px 10px;}',
      '.exp1-ad-avatar{flex:0 0 auto;width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:50% 22%;background:#12284C;display:block;}',
      '.exp1-ad-id{line-height:1.3;min-width:0;}',
      '.exp1-ad-name{font-size:15px;font-weight:700;color:#12284C;}',
      '.exp1-ad-meta{display:flex;align-items:center;gap:4px;font-size:13px;color:#65717F;margin-top:1px;}',
      '.exp1-ad-meta svg{display:block;opacity:.8;}',
      '.exp1-ad-body{padding:4px 16px 16px;}',
      '.exp1-ad-body p.exp1-ad-p{font-size:15px;line-height:1.55;color:#1c2530;margin:0 0 12px;}',
      '.exp1-ad-body p.exp1-ad-p:last-child{margin-bottom:0;}',
      '.exp1-ad-body p.exp1-ad-disclaimer{font-size:12.5px;line-height:1.45;color:#65717F;padding-top:12px;margin-top:4px;border-top:1px solid #E2E6EB;}'
    ].join("\n");
    var style = document.createElement("style");
    style.id = "exp1-ad-styles";
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.getElementsByTagName("head")[0].appendChild(style);
  }

});
