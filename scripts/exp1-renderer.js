Qualtrics.SurveyEngine.addOnload(function() {

  /*
    EXPERIMENT 1 — ad renderer (place on the treatment/ad question).

    The treatment question's HTML must contain a target div:
        <div id="adDisplay"></div>

    This script re-fetches the assigned arm's text and fills placeholders,
    then writes it into #adDisplay as clean paragraphs. We RE-FETCH rather
    than pipe ${e://Field/exp1_treatment_text}, because piping a multi-paragraph
    value (a) drops the paragraph breaks in question text and (b) is a JS
    syntax error if read into a "..." string. Only single-line fields
    (arm, name, state) are read via piping here — that's safe.

    Also holds the Next button for READ_DELAY_MS so respondents can read.
  */

  var qThis = this;

  const BASE_URL = "https://williammarble.com/social-ties-survey/exp1/";
  const READ_DELAY_MS = 7000; // brief forced reading window before Next appears

  var arm = "${e://Field/exp1_tr_arm}".trim();
  var candidateName = "${e://Field/exp1_candidate_name}".trim();
  var candidateLast = "${e://Field/exp1_candidate_last}".trim();
  var respState = "${e://Field/resp_state}".trim();
  if (respState === "" || respState.indexOf("e://Field") !== -1) {
    respState = "your state";
  }

  // ---- Force a short reading window ----
  qThis.hideNextButton();
  setTimeout(() => { qThis.showNextButton(); }, READ_DELAY_MS);

  var target = document.getElementById("adDisplay");

  var url = BASE_URL + arm + ".txt";
  fetch(url)
    .then(response => response.text())
    .then(raw => {
      const filled = raw
        .replace(/\[CANDIDATE NAME\]/gi, candidateName)
        .replace(/\[CANDIDATE LAST NAME\]/gi, candidateLast)
        .replace(/\[STATE\]/gi, respState);

      // Split on blank lines -> paragraphs; collapse any stray single newlines.
      const paras = filled.split(/\n\s*\n/).filter(p => p.trim() !== "");
      const html = paras
        .map(p => '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>")
        .join("");

      console.log("Exp1 rendered arm:", arm);
      if (target) {
        target.innerHTML = html;
      }
    })
    .catch(error => {
      console.error("Exp1 renderer: failed to load ad text:", error);
      if (target) {
        target.innerHTML = '<p style="color:#b00;">Sorry — the ad failed to load. Please refresh the page.</p>';
      }
      qThis.showNextButton();
    });

});
