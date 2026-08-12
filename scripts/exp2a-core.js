/*
  EXPERIMENT 2A — core logic (parse / classify / dedupe / select / render).
  Runs in the browser (Qualtrics) AND in Node (harness). Qualtrics dialect:
  no async/await, no ?., no ??. All respondent text written to embedded data
  goes through sanitize() so downstream piping is safe by construction.
  Spec: survey/exp2a-design-spec.md
*/
var EXP2A = (function () {
  "use strict";

  var DOMAINS = ["transport", "job", "money", "other"];

  // Strip everything that could break a pipe target (JS literal, JSON body,
  // HTML attribute). Keep apostrophes/hyphens — they are name characters.
  function sanitize(s) {
    if (s === null || s === undefined) { return ""; }
    return String(s)
      .replace(/["\\`<>]/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu;

  // Entry-level cleanup for parsing (NOT for ED writes — that is sanitize()).
  // Returns "" when the entry has fewer than 2 letters after cleanup.
  function normalizeEntry(raw) {
    if (raw === null || raw === undefined) { return ""; }
    var t = String(raw)
      .replace(EMOJI_RE, " ")
      .replace(/^["'\s]+|["'\s!?.…]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    var letters = t.match(/\p{L}/gu);
    if (!letters || letters.length < 2) { return ""; }
    return t;
  }

  // "Mom and Dad" / "Maria & James" -> two candidates. The caller decides
  // whether to accept the split (only if every part classifies cleanly).
  function splitCandidates(text) {
    var parts = text.split(/\s+(?:and|&)\s+/i);
    if (parts.length < 2) { return [text]; }
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p !== "") { out.push(p); }
    }
    return out.length >= 2 ? out : [text];
  }

  return {
    DOMAINS: DOMAINS,
    sanitize: sanitize,
    normalizeEntry: normalizeEntry,
    splitCandidates: splitCandidates
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = EXP2A; }
