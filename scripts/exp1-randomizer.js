Qualtrics.SurveyEngine.addOnload(function() {

  /*
    EXPERIMENT 1 — hidden randomizer (place on a hidden question that sits
    immediately BEFORE the treatment/ad question).

    What it does, invisibly (except a loading spinner):
      (a) randomizes one of 4 arms with equal allocation
      (b) stores the arm + candidate fields as embedded data
      (c) fetches the arm's ad text from the public site
      (d) fills [CANDIDATE NAME] / [CANDIDATE LAST NAME] / [STATE] placeholders
      (e) stores the fully assembled ad as embedded data `treatment_text`
      (f) advances to the treatment question (INSIDE the fetch .then())

    The treatment question re-fetches + renders the ad (see exp1-renderer.js);
    `treatment_text` here is stored for the data record.
  */

  var qThis = this;

  // ---- Config ----
  const BASE_URL = "https://williammarble.com/social-ties-survey/exp1/";
  const ARMS = ["anti-baseline", "anti-fiscal", "anti-crowdout", "control-valence"];
  const CANDIDATE_NAME = "Mark Anderson";
  const CANDIDATE_LAST = "Anderson";

  // Respondent's state from earlier in the survey (single-line pipe = safe).
  // Falls back to a generic phrase if it wasn't captured / field is empty.
  var respState = "${e://Field/resp_state}".trim();
  if (respState === "" || respState.indexOf("e://Field") !== -1) {
    respState = "your state";
  }

  // Existing assignment (guards against re-randomizing on refresh / back nav).
  var existingArm = "${e://Field/tr_arm}".trim();

  // ---- Hide question content + nav, show a loading spinner ----
  this.getQuestionContainer().style.display = "none";
  qThis.hideNextButton();
  qThis.hidePreviousButton();

  var spinner = document.createElement("div");
  spinner.setAttribute("id", "loadingSpinner");
  spinner.setAttribute("style", "border:8px solid #f3f3f3; border-top:8px solid #3498db; border-radius:50%; width:50px; height:50px; animation:spin 1s linear infinite; margin:50px auto;");
  document.body.appendChild(spinner);

  var style = document.createElement("style");
  style.innerHTML = "@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }";
  document.head.appendChild(style);

  // ---- Choose arm (reuse existing assignment if valid) ----
  var arm;
  if (existingArm !== "" && ARMS.indexOf(existingArm) !== -1) {
    arm = existingArm;
  } else {
    arm = ARMS[Math.floor(Math.random() * ARMS.length)];
  }
  console.log("Exp1 arm:", arm);

  // ---- Store assignment + candidate fields immediately ----
  Qualtrics.SurveyEngine.setEmbeddedData("tr_arm", arm);
  Qualtrics.SurveyEngine.setEmbeddedData("candidate_name", CANDIDATE_NAME);
  Qualtrics.SurveyEngine.setEmbeddedData("candidate_last", CANDIDATE_LAST);

  // ---- Fetch ad text, fill placeholders, store, then advance ----
  var url = BASE_URL + arm + ".txt";
  fetch(url)
    .then(response => response.text())
    .then(raw => {
      const assembled = raw
        .replace(/\[CANDIDATE NAME\]/gi, CANDIDATE_NAME)
        .replace(/\[CANDIDATE LAST NAME\]/gi, CANDIDATE_LAST)
        .replace(/\[STATE\]/gi, respState);
      console.log("Exp1 assembled ad:\n", assembled);

      Qualtrics.SurveyEngine.setEmbeddedData("treatment_text", assembled);

      var s = document.getElementById("loadingSpinner");
      if (s) { s.remove(); }
      qThis.clickNextButton();
    })
    .catch(error => {
      // The arm is already stored; don't strand the respondent — let them advance.
      console.error("Exp1 randomizer: failed to load ad text:", error);
      Qualtrics.SurveyEngine.setEmbeddedData("treatment_text", "");
      var s2 = document.getElementById("loadingSpinner");
      if (s2) { s2.remove(); }
      qThis.showNextButton();
      qThis.showPreviousButton();
    });

});
