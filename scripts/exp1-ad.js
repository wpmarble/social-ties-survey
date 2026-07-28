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

  // Respondent's state, filled from earlier in the survey. Falls back if empty.
  var respState = "${e://Field/resp_state}".trim();
  if (respState === "" || respState.indexOf("e://Field") !== -1) {
    respState = "your state";
  }

  // Reuse an existing assignment if present (guards re-randomizing on back/refresh).
  var existingArm = "${e://Field/exp1_tr_arm}".trim();

  // ---- Choose arm ----
  var arm;
  if (existingArm !== "" && ARMS.indexOf(existingArm) !== -1) {
    arm = existingArm;
  } else {
    arm = ARMS[Math.floor(Math.random() * ARMS.length)];
  }
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

  // ---- Fetch, fill, store, render ----
  fetch(BASE_URL + arm + ".txt")
    .then(response => response.text())
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
      console.error("Exp1: failed to load ad text:", error);
      if (target) {
        target.innerHTML = '<p style="color:#b00;">Sorry — the ad failed to load. Please refresh the page.</p>';
      }
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
