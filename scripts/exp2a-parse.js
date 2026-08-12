/* GENERATED FILE — do not edit. Edit exp2a-core.js / exp2a-hooks/* and re-run: node scripts/exp2a-build.js */
/*
  EXPERIMENT 2A — core logic (parse / classify / dedupe / select / render).
  Runs in the browser (Qualtrics) AND in Node (harness). Qualtrics dialect:
  no async/await, no optional chaining, no nullish coalescing. All respondent text written to embedded data
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
      .replace(/^["'\s]+|["'\s!.?…]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length > 120) { return ""; }
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

  // --- wordlists -----------------------------------------------------------
  var SPOUSE_WORDS = ["spouse", "wife", "husband", "partner", "fiance", "fiancee",
    "fiancé", "fiancée", "boyfriend", "girlfriend", "bf", "gf", "hubby", "wifey",
    "significant other", "my other half", "life partner"];

  // relationship word -> coarse category (category used for diagnostics only)
  var REL_WORDS = {};
  (function () {
    function add(words, cat) {
      for (var i = 0; i < words.length; i++) { REL_WORDS[words[i]] = cat; }
    }
    add(["mom", "mother", "momma", "mama", "dad", "father", "papa", "pop",
         "stepmom", "stepdad", "stepmother", "stepfather",
         "mother in law", "father in law", "sister in law", "brother in law",
         "son in law", "daughter in law",
         "sister", "sis", "brother", "bro", "aunt", "auntie", "uncle", "cousin",
         "grandma", "grandmother", "nana", "granny", "grandpa", "grandfather",
         "son", "daughter", "niece", "nephew", "grandson", "granddaughter",
         "godmother", "godfather", "godparent"], "family");
    add(["friend", "buddy", "pal", "bestie", "roommate", "housemate"], "friend");
    add(["neighbor", "neighbour"], "neighbor");
    add(["coworker", "co worker", "colleague", "boss", "supervisor", "manager",
         "mentor", "coach"], "coworker");
    add(["pastor", "priest", "rabbi", "imam", "minister", "deacon"], "religious");
    add(["doctor", "therapist", "counselor", "lawyer", "teacher", "professor",
         "babysitter", "nanny", "caregiver", "landlord"], "professional");
  })();

  var REL_MODIFIERS = ["my", "our", "a", "the", "best", "close", "good", "old",
    "older", "younger", "little", "big", "childhood", "college", "church",
    "work", "family", "dear", "longtime", "twin", "half", "step", "great"];

  var UNUSABLE_EXACT = ["nobody", "no one", "noone", "none", "n a", "na",
    "nothing", "nope", "no", "idk", "i dont know", "dont know", "not sure",
    "myself", "me", "self", "same", "same as above", "see above", "x", "xx",
    "unknown", "not applicable", "no idea"];

  // --- classification helpers ----------------------------------------------
  function lowerKey(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }

  // "my childhood friend" -> {rel: "childhood friend", spouse: false}; null if not a rel phrase.
  // The returned rel keeps informative modifiers (childhood, best, ...) but drops
  // my/our/a/the so the template can say "(your childhood friend)".
  function parseRelPhrase(s) {
    var words = lowerKey(s).split(" ");
    if (words.length === 0 || words[0] === "") { return null; }
    // multi-word rel entries ("mother in law") get matched greedily from each start
    var kept = [];
    var i = 0;
    while (i < words.length) {
      var matched = null;
      for (var len = Math.min(3, words.length - i); len >= 1; len--) {
        var cand = words.slice(i, i + len).join(" ");
        if (SPOUSE_WORDS.indexOf(cand) !== -1) { matched = { word: cand, spouse: true, len: len }; break; }
        if (REL_WORDS[cand]) { matched = { word: cand, spouse: false, len: len }; break; }
      }
      if (matched) {
        // must be the FINAL content of the phrase
        if (i + matched.len !== words.length) { return null; }
        var informative = [];
        for (var k = 0; k < kept.length; k++) {
          if (["my", "our", "a", "the"].indexOf(kept[k]) === -1) { informative.push(kept[k]); }
        }
        return { rel: informative.concat([matched.word]).join(" "), spouse: matched.spouse };
      }
      if (REL_MODIFIERS.indexOf(words[i]) === -1) { return null; }
      kept.push(words[i]);
      i++;
    }
    return null;
  }

  var NAME_TOKEN_RE = /^\p{Lu}[\p{L}'.\u2019-]*$/u;      // capitalized token
  function isNameLike(s) {
    var toks = s.trim().split(/\s+/);
    if (toks.length < 1 || toks.length > 3) { return false; }
    for (var i = 0; i < toks.length; i++) {
      if (!NAME_TOKEN_RE.test(toks[i])) { return false; }
    }
    return parseRelPhrase(s) === null;
  }

  var HONORIFIC_RE = /^(Pastor|Father|Rev\.?|Reverend|Dr\.?|Coach|Ms\.?|Mr\.?|Mrs\.?)\s+\p{Lu}[\p{L}'.\u2019-]*$/u;

  // --- the classifier -------------------------------------------------------
  // Claims only certain patterns; anything ambiguous returns cls "residue"
  // so the LLM resolves it (generous triggering, WM 2026-08-12).
  function classifyEntry(text) {
    var lk = lowerKey(text);
    if (UNUSABLE_EXACT.indexOf(lk) !== -1) { return { cls: "unusable", name: null, rel: null }; }

    // 1. separator form: "<name> SEP <rel>" or "<rel> SEP <name>"; also "(rel)"
    var m = text.match(/^(.+?)\s*(?:\u2014|\u2013|-|,|:|;|\()\s*(.+?)\)?\s*$/);
    if (m) {
      var a = m[1].trim(), b = m[2].trim();
      var relB = parseRelPhrase(b), relA = parseRelPhrase(a);
      if (relB && isNameLike(a)) {
        if (relB.spouse) { return { cls: "spouse", name: null, rel: null }; }
        // rel side may carry a trailing description ("neighbor across the street"):
        // parseRelPhrase already rejected that, so retry on the first rel word run.
        return { cls: "named_rel", name: firstNameOf(a), rel: relB.rel };
      }
      if (!relB && isNameLike(a)) {
        var relB2 = leadingRelOf(b);
        if (relB2) {
          if (relB2.spouse) { return { cls: "spouse", name: null, rel: null }; }
          return { cls: "named_rel", name: firstNameOf(a), rel: relB2.rel };
        }
      }
      if (relA && isNameLike(b)) {
        if (relA.spouse) { return { cls: "spouse", name: null, rel: null }; }
        return { cls: "named_rel", name: firstNameOf(b), rel: relA.rel };
      }
    }

    // 2. "my <rel> <Name>" (no separator)
    m = text.match(/^((?:[Mm]y|[Oo]ur)\s+.+?)\s+(\p{Lu}[\p{L}'.\u2019-]*)$/u);
    if (m) {
      var relLead = parseRelPhrase(m[1]);
      if (relLead && NAME_TOKEN_RE.test(m[2])) {
        if (relLead.spouse) { return { cls: "spouse", name: null, rel: null }; }
        return { cls: "named_rel", name: m[2], rel: relLead.rel };
      }
    }
    // 3. "<Name> my <rel>" (no separator)
    m = text.match(/^(\p{Lu}[\p{L}'.\u2019-]*)\s+((?:[Mm]y|[Oo]ur)\s+.+)$/u);
    if (m) {
      var relTail = parseRelPhrase(m[2]);
      if (relTail && NAME_TOKEN_RE.test(m[1])) {
        if (relTail.spouse) { return { cls: "spouse", name: null, rel: null }; }
        return { cls: "named_rel", name: m[1], rel: relTail.rel };
      }
    }

    // 4. whole entry is a rel phrase
    var relWhole = parseRelPhrase(text);
    if (relWhole) {
      if (relWhole.spouse) { return { cls: "spouse", name: null, rel: null }; }
      return { cls: "rel_only", name: null, rel: relWhole.rel };
    }

    // 5. honorific + surname stays whole ("Pastor Williams"); rel stays null so
    //    the "(your ...)" clause is naturally suppressed.
    if (HONORIFIC_RE.test(text)) { return { cls: "name_only", name: text, rel: null }; }

    // 6. capitalized name(s): keep first token of a multi-token full name.
    // A capitalized determiner as the first token ("The Church Ladies", "My
    // Homie") is not a name — no legitimate rel phrase resolved above, so
    // this is ambiguous residue, not a name (WM 2026-08-12: ambiguity ->
    // residue, never stretch a heuristic).
    if (isNameLike(text)) {
      var first6 = text.trim().split(/\s+/)[0].toLowerCase();
      if (first6 === "my" || first6 === "our" || first6 === "the" || first6 === "a") {
        return { cls: "residue", name: null, rel: null };
      }
      return { cls: "name_only", name: firstNameOf(text), rel: null };
    }

    return { cls: "residue", name: null, rel: null };
  }

  // Skips leading determiner tokens (my/our/the/a) so a phrase like "The Bob"
  // (reachable via the separator branches' isNameLike side) never yields the
  // determiner as the name; always leaves at least the final token.
  function firstNameOf(s) {
    if (HONORIFIC_RE.test(s)) { return s; }
    var toks = s.trim().split(/\s+/);
    if (toks.length <= 1) { return s.trim(); }
    var i = 0;
    while (i < toks.length - 1 && /^(?:my|our|the|a)$/i.test(toks[i])) { i++; }
    return toks[i];
  }

  // "neighbor across the street" -> {rel:"neighbor"} (leading rel word, trailing description)
  function leadingRelOf(s) {
    var words = lowerKey(s).split(" ");
    var start = 0;
    while (start < words.length && REL_MODIFIERS.indexOf(words[start]) !== -1) { start++; }
    for (var len = Math.min(3, words.length - start); len >= 1; len--) {
      var cand = words.slice(start, start + len).join(" ");
      if (SPOUSE_WORDS.indexOf(cand) !== -1) { return { rel: cand, spouse: true }; }
      if (REL_WORDS[cand]) { return { rel: cand, spouse: false }; }
    }
    return null;
  }

  var CLS_RANK = { named_rel: 3, name_only: 2, rel_only: 1 };

  function pairKey(p) {
    if (p.name) { return "n:" + p.name.toLowerCase().replace(/[^\p{L}]/gu, ""); }
    return "r:" + (p.rel || "").toLowerCase();
  }

  function dedupePairs(pairs) {
    var byKey = {}, order = [];
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i], k = pairKey(p);
      if (!byKey[k]) { byKey[k] = p; order.push(k); continue; }
      var q = byKey[k];
      // union domains, earliest mention, richest info wins
      for (var d = 0; d < p.domains.length; d++) {
        if (q.domains.indexOf(p.domains[d]) === -1) { q.domains.push(p.domains[d]); }
      }
      if (p.firstIndex < q.firstIndex) { q.firstIndex = p.firstIndex; }
      if (CLS_RANK[p.cls] > CLS_RANK[q.cls]) { q.cls = p.cls; }
      if (!q.rel && p.rel) { q.rel = p.rel; }
      if (!q.name && p.name) { q.name = p.name; }
    }
    var out = [];
    for (var j = 0; j < order.length; j++) { out.push(byKey[order[j]]); }
    return out;
  }

  function selectPairs(pairs, maxN) {
    var n = maxN || 3;
    var sorted = pairs.slice().sort(function (a, b) {
      var ma = a.domains.length > 1 ? 1 : 0, mb = b.domains.length > 1 ? 1 : 0;
      if (ma !== mb) { return mb - ma; }
      if (CLS_RANK[a.cls] !== CLS_RANK[b.cls]) { return CLS_RANK[b.cls] - CLS_RANK[a.cls]; }
      return a.firstIndex - b.firstIndex;
    });
    return sorted.slice(0, n);
  }

  // The single deterministic entry point (parse hook calls exactly this).
  function processSlots(slots) {
    var pairs = [], residue = [], nSpouse = 0;
    for (var i = 0; i < slots.length; i++) {
      var cleaned = normalizeEntry(slots[i].text);
      if (cleaned === "") { continue; }
      var cands = splitCandidates(cleaned);
      var results = [], anyResidue = false;
      for (var c = 0; c < cands.length; c++) {
        var r = classifyEntry(cands[c]);
        results.push(r);
        if (r.cls === "residue") { anyResidue = true; }
      }
      if (cands.length > 1 && anyResidue) {
        // split didn't resolve cleanly — treat the whole entry as one unit
        results = [classifyEntry(cleaned)];
      }
      for (var k = 0; k < results.length; k++) {
        var res = results[k];
        if (res.cls === "unusable") { continue; }
        if (res.cls === "spouse") { nSpouse++; continue; }
        if (res.cls === "residue") {
          residue.push({ text: sanitize(k === 0 && results.length === 1 ? cleaned : cands[k]), domain: slots[i].domain, index: i });
          continue;
        }
        pairs.push({
          name: res.name ? sanitize(res.name) : null,
          rel: res.rel ? sanitize(res.rel) : null,
          cls: res.cls, domains: [slots[i].domain], firstIndex: i
        });
      }
    }
    return { pairs: dedupePairs(pairs), residue: residue, needsLlm: residue.length > 0, nSpouse: nSpouse };
  }

  function displayNameOf(p) { return p.name ? p.name : "your " + p.rel; }

  function decideVariant(arm, usableCount) {
    if (arm === "placebo") { return { variant: "placebo", lowTie: 0 }; }
    if (usableCount >= 3) { return { variant: "named3", lowTie: 0 }; }
    if (usableCount === 2) { return { variant: "named2", lowTie: 0 }; }
    return { variant: "generic", lowTie: 1 };
  }

  function reflectClause(selected) {
    var names = [];
    for (var i = 0; i < selected.length; i++) { names.push(displayNameOf(selected[i])); }
    if (names.length >= 3) { return names[0] + ", " + names[1] + ", and " + names[2]; }
    if (names.length === 2) { return names[0] + " and " + names[1]; }
    return names.join("");
  }

  function composeStimulus(templateText, selected) {
    var text = templateText;
    for (var k = 0; k < 3; k++) {
      var p = selected[k];
      var name = p ? displayNameOf(p) : "";
      // "(your sister)" only when we have BOTH a real name and a relationship
      var clause = (p && p.name && p.rel) ? " (your " + p.rel + ")" : "";
      text = text.split("[NAME" + (k + 1) + "]").join(name)
                 .split("[RELCLAUSE" + (k + 1) + "]").join(clause);
    }
    return text.split("[REFLECT_CLAUSE]").join(reflectClause(selected));
  }

  function buildResidueString(residue) {
    var parts = [];
    for (var i = 0; i < residue.length; i++) {
      parts.push(residue[i].domain + ": " + residue[i].text);
    }
    return parts.join(" ||| ");
  }

  var LLM_DROP = { spouse_partner: 1, group: 1, unusable: 1 };

  function mergeLlm(detPairs, llmRaw, residue) {
    var entries = null;
    try {
      var parsed = JSON.parse(llmRaw);
      if (Object.prototype.toString.call(parsed) === "[object Array]") { entries = parsed; }
      else if (parsed && Object.prototype.toString.call(parsed.entries) === "[object Array]") { entries = parsed.entries; }
    } catch (e) { entries = null; }
    if (!entries) { return detPairs; }

    var llmPairs = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || e.usable !== true) { continue; }
      var cat = e.category ? sanitize(String(e.category)).toLowerCase() : "";
      if (LLM_DROP[cat]) { continue; }
      var name = e.name ? sanitize(String(e.name)).split(/\s+/)[0] : null;
      var rel = e.relationship ? sanitize(String(e.relationship)).toLowerCase() : null;
      if (rel) {
        // LLM relationship strings aren't wordlist-exact ("my husband", not
        // "husband") — run them through the same rel-phrase resolver the
        // deterministic parser uses so multi-word spouse phrasing can't slip
        // past a benign `category`. If it resolves, use the NORMALIZED rel
        // (strips leading my/our) so clauses read "(your husband)" not
        // "(your my husband)". If it doesn't resolve (e.g. "ride or die",
        // "childhood friend" already normalized), keep rel as-is — the LLM
        // may legitimately return rels outside the wordlist.
        var relResolved = parseRelPhrase(rel) || leadingRelOf(rel);
        if (relResolved) {
          if (relResolved.spouse) { continue; }
          rel = relResolved.rel;
        }
      }
      if (!name && !rel) { continue; }
      // locate the source residue row for domain/index (order fallback)
      var src = null;
      for (var j = 0; j < residue.length; j++) {
        if (sanitize(String(e.text || "")) === residue[j].text) { src = residue[j]; break; }
      }
      if (!src) { src = residue[Math.min(i, residue.length - 1)] || { domain: "other", index: 99 }; }
      llmPairs.push({
        name: name, rel: rel,
        cls: name ? (rel ? "named_rel" : "name_only") : "rel_only",
        domains: [src.domain], firstIndex: src.index
      });
    }
    return dedupePairs(detPairs.concat(llmPairs));
  }

  return {
    DOMAINS: DOMAINS,
    sanitize: sanitize,
    normalizeEntry: normalizeEntry,
    splitCandidates: splitCandidates,
    classifyEntry: classifyEntry,
    processSlots: processSlots,
    dedupePairs: dedupePairs,
    selectPairs: selectPairs,
    displayNameOf: displayNameOf,
    decideVariant: decideVariant,
    composeStimulus: composeStimulus,
    buildResidueString: buildResidueString,
    mergeLlm: mergeLlm,
    CLS_RANK: CLS_RANK
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = EXP2A; }

/*
  EXP 2A parse hook — paste target: QID45 (last name-generator page).
  The question HTML must contain the hidden #exp2aPrior div with nine
  .exp2a-slot spans (server-piped pages 1-3); see exp2a-WIRING.md §2.
  All logic is in EXP2A (exp2a-core.js) — this file only harvests and stores.
*/
// `this` inside addOnPageSubmit as question-context is not a documented
// Qualtrics guarantee. addOnload's `this` IS documented as the question
// context, so we capture it there and close over it in the submit handler.
Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;
  Qualtrics.SurveyEngine.addOnPageSubmit(function (type) {
    if (type === "prev") { return; }
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
});
