/*
  EXP 2A parse hook — paste target: QID45 (last name-generator page).
  The question HTML must contain the hidden #exp2aPrior div with nine
  .exp2a-slot spans (server-piped pages 1-3); see exp2a-WIRING.md §2.
  All logic is in EXP2A (exp2a-core.js) — this file only harvests and stores.
*/
Qualtrics.SurveyEngine.addOnPageSubmit(function (type) {
  if (type === "prev") { return; }
  var qThis = this;
  var slots = [];
  var prior = document.getElementById("exp2aPrior");
  if (prior) {
    var spans = prior.querySelectorAll(".exp2a-slot");
    for (var i = 0; i < spans.length; i++) {
      slots.push({ text: spans[i].textContent, domain: spans[i].getAttribute("data-domain") });
    }
  }
  var inputs = qThis.getQuestionContainer().querySelectorAll("input[type=text], textarea");
  for (var j = 0; j < inputs.length; j++) {
    slots.push({ text: inputs[j].value, domain: "other" });
  }
  var out = EXP2A.processSlots(slots);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_det_pairs", JSON.stringify(out.pairs));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_residue", EXP2A.buildResidueString(out.residue));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_needs_llm", out.needsLlm ? "1" : "0");
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_llm_status", out.needsLlm ? "" : "skipped");
  console.log("Exp2A parse:", out.pairs.length, "pairs,", out.residue.length, "residue, spouse:", out.nSpouse);
});
