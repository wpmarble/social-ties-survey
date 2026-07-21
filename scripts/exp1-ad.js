Qualtrics.SurveyEngine.addOnload(function() {

  /*
    EXPERIMENT 1 — candidate-ad randomizer + renderer.
    Place on the treatment/ad question. Its HTML must contain:
        <div id="adDisplay"></div>

    On load:
      (a) randomizes one of 4 arms (equal allocation)
      (b) stores arm + candidate fields + assembled ad as embedded data
      (c) fetches the arm's text, fills the [CANDIDATE NAME] / [CANDIDATE LAST NAME] / [STATE] placeholders
      (d) renders it into #adDisplay as paragraphs
      (e) holds the Next button for READ_DELAY_MS after the ad appears
  */

  var qThis = this;

  // ---- Config ----
  const BASE_URL = "https://williammarble.com/social-ties-survey/exp1/";
  const ARMS = ["anti-baseline", "anti-fiscal", "anti-crowdout", "control-valence"];
  const CANDIDATE_NAME = "Mark Anderson";
  const CANDIDATE_LAST = "Anderson";
  const READ_DELAY_MS = 7000; // reading window after the ad renders

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

  // ---- Hold Next until the ad is on screen; show a placeholder ----
  qThis.hideNextButton();
  var target = document.getElementById("adDisplay");
  if (target) {
    target.innerHTML = '<p style="text-align:center; color:#888;">Loading…</p>';
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

      const paras = filled.split(/\n\s*\n/).filter(p => p.trim() !== "");
      const html = paras
        .map(p => '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>")
        .join("");
      if (target) {
        target.innerHTML = html;
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

});
