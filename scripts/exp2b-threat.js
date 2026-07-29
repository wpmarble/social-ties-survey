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
  var arm;
  if (ARMS.indexOf(existing) !== -1) { arm = existing; }
  else { arm = ARMS[Math.floor(Math.random() * ARMS.length)]; }

  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_arm", arm);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_ind_code", String(indCode));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2b_occ_code", String(occCode));
  console.log("Exp2B arm:", arm, "ind:", indCode, "occ:", occCode);

  var target = document.getElementById("exp2bDisplay");
  if (target) { target.innerHTML = '<p style="color:#888;">Loading…</p>'; }

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
    }
    console.log("Exp2B frame:", frame, "\n", text);
  }

  const EMPTY = { churn_pct: "", decline_pct: "", churn_unit: "", decline_unit: "" };

  // Placebo needs one file and no lookup.
  if (arm === "placebo") {
    fetch(BASE + "templates/placebo.txt")
      .then(r => r.text())
      .then(t => { render(t.trim(), "placebo", EMPTY); })
      .catch(e => {
        console.error("Exp2B placebo fetch failed:", e);
        render("We'd like you to think about how you get to work or run errands. " +
               "Consider your typical commute or grocery run.", "placebo", EMPTY);
      });
    return;
  }

  // Threat arm: lookup + templates together.
  Promise.all([
    fetch(BASE + "exp2_lookup.json").then(r => r.json()),
    fetch(BASE + "templates/lede.txt").then(r => r.text()),
    fetch(BASE + "templates/stat-churn.txt").then(r => r.text()),
    fetch(BASE + "templates/stat-decline.txt").then(r => r.text()),
    fetch(BASE + "templates/stat-generic.txt").then(r => r.text())
  ]).then(function(res) {
    const lookup = res[0];
    const lede = res[1].trim(), churn = res[2].trim();
    const decline = res[3].trim(), generic = res[4].trim();

    var cell = null;
    if (indCode > 0 && occCode > 0 && lookup[String(indCode)]) {
      cell = lookup[String(indCode)][String(occCode)];
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
    console.error("Exp2B fetch failed:", e);
    render("Imagine you found out your workplace was planning significant layoffs " +
           "in the coming months, and your own job might be at risk.", "generic", EMPTY);
  });

});
