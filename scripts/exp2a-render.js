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
      if (!Array.isArray(p.domains)) { p.domains = []; }
      if (!Array.isArray(q.domains)) { q.domains = []; }
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
      var ma = (a.domains && a.domains.length > 1) ? 1 : 0, mb = (b.domains && b.domains.length > 1) ? 1 : 0;
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

  // The residue string sent to the LLM is "domain: text"; the model may echo that prefix back despite the prompt.
  var DOMAIN_PREFIX_RE = new RegExp("^\\s*(" + DOMAINS.join("|") + ")\\s*:\\s*", "i");
  function stripDomainPrefix(t) { return String(t).replace(DOMAIN_PREFIX_RE, ""); }

  var LLM_DROP = { spouse_partner: 1, group: 1, unusable: 1 };

  // Parse the exp2a_residue string ("domain: text ||| domain: text ...", exactly what buildResidueString writes) into
  // residue rows. Only (domain, text) survive the string, so index = domain base + ordinal among that domain's residue
  // rows: exact across domains and in-domain order, but not the absolute slot number.
  var DOMAIN_BASE = { transport: 0, job: 3, money: 6, other: 9 };
  var RESIDUE_PART_RE = /^(transport|job|money|other):\s*(.*)$/;
  function parseResidueString(str) {
    var rows = [], seen = { transport: 0, job: 0, money: 0, other: 0 };
    var parts = String(str === null || str === undefined ? "" : str).split(" ||| ");
    for (var i = 0; i < parts.length; i++) {
      var m = RESIDUE_PART_RE.exec(parts[i].trim());
      if (!m) { continue; }
      rows.push({ text: m[2].trim(), domain: m[1], index: DOMAIN_BASE[m[1]] + seen[m[1]] });
      seen[m[1]]++;
    }
    return rows;
  }

  function residueKey(t) { return sanitize(String(t === null || t === undefined ? "" : t)).toLowerCase(); }

  // Returns { pairs, nLlm }: nLlm = LLM pairs accepted (matched to a residue row and usable) before dedupe.
  function mergeLlmDetailed(detPairs, llmRaw, residue) {
    var entries = null;
    try {
      var parsed = JSON.parse(llmRaw);
      if (Object.prototype.toString.call(parsed) === "[object Array]") { entries = parsed; }
      else if (parsed && Object.prototype.toString.call(parsed.entries) === "[object Array]") { entries = parsed.entries; }
    } catch (e) { entries = null; }
    if (!entries) { return { pairs: detPairs, nLlm: 0 }; }
    residue = Object.prototype.toString.call(residue) === "[object Array]" ? residue : [];

    // Match every entry to a distinct residue row. Pass 1: text (domain prefix stripped; as-is as a second try), each row
    // used once so identical texts map to distinct rows. Pass 2: an unmatched entry takes the row at its own position, but
    // only when the model returned exactly one entry per row; otherwise the entry is invented and is dropped.
    var used = [], src = [], i, j;
    for (j = 0; j < residue.length; j++) { used.push(false); }
    for (i = 0; i < entries.length; i++) {
      src.push(null);
      var e0 = entries[i];
      if (!e0) { continue; }
      var full = residueKey(e0.text), stripped = residueKey(stripDomainPrefix(sanitize(String(e0.text === null || e0.text === undefined ? "" : e0.text))));
      var cands = [stripped, full];
      for (var c = 0; c < cands.length && src[i] === null; c++) {
        for (j = 0; j < residue.length; j++) {
          if (!used[j] && residueKey(residue[j].text) === cands[c]) { used[j] = true; src[i] = residue[j]; break; }
        }
      }
    }
    if (entries.length === residue.length) {
      for (i = 0; i < entries.length; i++) {
        if (src[i] === null && entries[i] && !used[i]) { used[i] = true; src[i] = residue[i]; }
      }
    }

    var llmPairs = [];
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || e.usable !== true || src[i] === null) { continue; }
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
      llmPairs.push({
        name: name, rel: rel,
        cls: name ? (rel ? "named_rel" : "name_only") : "rel_only",
        domains: [src[i].domain], firstIndex: src[i].index
      });
    }
    return { pairs: dedupePairs(detPairs.concat(llmPairs)), nLlm: llmPairs.length };
  }

  function mergeLlm(detPairs, llmRaw, residue) { return mergeLlmDetailed(detPairs, llmRaw, residue).pairs; }

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
    reflectClause: reflectClause,
    composeStimulus: composeStimulus,
    buildResidueString: buildResidueString,
    mergeLlm: mergeLlm,
    mergeLlmDetailed: mergeLlmDetailed,
    parseResidueString: parseResidueString,
    CLS_RANK: CLS_RANK
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = EXP2A; }

/*
  EXP 2A render hook — paste target: the Exp 2A display question.
  Question HTML must contain:
      <div id="exp2aDisplay"></div>
      <div id="exp2aData" style="display:none"> holding spans, whose ids
      are exp2a-det, exp2a-llm and exp2a-llmstatus, piped from the embedded-data
      fields exp2a_det_pairs, exp2a_llm_pairs and exp2a_llm_status, plus a fourth span exp2a-residue
      piped from exp2a_residue (exact markup
      in exp2a-WIRING.md section 3).
  Respondent-derived text reaches this script ONLY via textContent of those
  spans — never via JS literals. exp2a_arm below is our own controlled value.
  Never put piped-text tokens in a comment: Qualtrics fills them there too, and a
  value containing the comment terminator would break the script
  (scripts/test-no-pipes-in-comments.js enforces).
  Next-question guard: the essay on the same page (QID77) is hidden until the
  stimulus has rendered or the fallback has been shown (10 s failsafe).
*/
Qualtrics.SurveyEngine.addOnload(function () {
  var qThis = this;
  var BASE = "https://williammarble.com/social-ties-survey/exp2a/";
  var ARMS = ["tie", "placebo"];
  var ESSAY_QID = "QID77";          // the essay question on the same page as the stimulus
  var FETCH_TIMEOUT_MS = 8000;      // template fetch
  var ESSAY_FAILSAFE_MS = 10000;    // the essay is never hidden longer than this

  // ---- Hide the essay until the stimulus is on screen ----
  // Found by QID, else as the next .QuestionOuter after this question's own container.
  function hasClass(el, c) { return !!el && typeof el.className === "string" && (" " + el.className + " ").indexOf(" " + c + " ") !== -1; }
  function findEssay() {
    var el = document.getElementById(ESSAY_QID);
    if (el) { return el; }
    var node = null;
    try { node = qThis.getQuestionContainer(); } catch (e) { node = null; }
    while (node && !hasClass(node, "QuestionOuter")) { node = node.parentNode; }
    var sib = node ? node.nextElementSibling : null;
    while (sib && !hasClass(sib, "QuestionOuter")) { sib = sib.nextElementSibling; }
    return sib || null;
  }
  var essayEl = null;
  try { essayEl = findEssay(); } catch (e) { essayEl = null; }
  var essayRevealed = false;
  function revealEssay() {
    if (essayRevealed) { return; }
    essayRevealed = true;
    if (essayEl && essayEl.style) { essayEl.style.display = ""; }
  }
  if (essayEl && essayEl.style) { essayEl.style.display = "none"; }
  else { console.error("Exp2A: essay question not found; nothing hidden."); }
  setTimeout(revealEssay, ESSAY_FAILSAFE_MS);

  // fetch() resolves (does not reject) on HTTP 404/500 and can hang forever. getText rejects with
  // err.kind = "timeout" | "http_<status>" | "network". The timeout covers the body read.
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

  function nodeText(id) {
    var el = document.getElementById(id);
    return el ? el.textContent : "";
  }

  // arm: reuse guard (exp2b pattern) — survives back/refresh
  var existing = "${e://Field/exp2a_arm}".trim();
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
  var respId = "${e://Field/resp_id}".trim();
  var arm;
  if (ARMS.indexOf(existing) !== -1) { arm = existing; }
  else {
    var draw = drawArmWithFallback(ARMS, "exp2a", respId);
    arm = draw.arm;
    if (draw.fallback) {
      Qualtrics.SurveyEngine.setEmbeddedData("rng_seed_fallback", "1");
      console.log("Exp2A: resp_id missing/unreplaced; used fallback seed");
    }
  }
  Qualtrics.SurveyEngine.setEmbeddedData("rand_version", RAND_VERSION);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_arm", arm);

  // merge det + llm (both defensive), select, decide variant
  var detPairs = [];
  try { detPairs = JSON.parse(nodeText("exp2a-det") || "[]"); } catch (e) { detPairs = []; }
  if (Object.prototype.toString.call(detPairs) !== "[object Array]") { detPairs = []; }
  // Defensive: drop non-object entries; entries without a usable domains array get [].
  detPairs = detPairs.filter(function (p) { return p && typeof p === "object"; }).map(function (p) {
    if (Object.prototype.toString.call(p.domains) !== "[object Array]") { p.domains = []; }
    return p;
  });
  var llmStatus = nodeText("exp2a-llmstatus").trim();
  var needsLlm = llmStatus !== "skipped";
  var pairs = detPairs;
  var source = "det";
  if (needsLlm) {
    // "message" is Anthropic's response type on success (the Web Service maps it into exp2a_llm_status); "ok" kept for the old mapping.
    if (llmStatus === "ok" || llmStatus === "message") {
      // residue rows give each LLM pair its real domain/index; entries not in the residue are dropped
      var merged = EXP2A.mergeLlmDetailed(detPairs, nodeText("exp2a-llm"), EXP2A.parseResidueString(nodeText("exp2a-residue")));
      pairs = merged.pairs;
      // det+llm only if at least one LLM pair was actually merged; success with nothing usable is llm_empty
      source = merged.nLlm > 0 ? "det+llm" : "llm_empty";
    } else {
      source = "llm_failed";
    }
  }
  var selected = EXP2A.selectPairs(pairs, 3);
  var dv = EXP2A.decideVariant(arm, pairs.length);

  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_variant", dv.variant);
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_n_names", String(pairs.length));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_low_tie_flag", String(dv.lowTie));
  Qualtrics.SurveyEngine.setEmbeddedData("exp2a_parse_source", source);
  for (var k = 0; k < 3; k++) {
    var used = (dv.variant === "named3" && k < 3) || (dv.variant === "named2" && k < 2);
    var p = used ? selected[k] : null;
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_name" + (k + 1), p ? (p.name || "your " + p.rel) : "");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_rel" + (k + 1), p ? (p.rel || "") : "");
  }

  var target = document.getElementById("exp2aDisplay");
  if (target) { target.innerHTML = '<p style="color:#888;">Loading…</p>'; }
  else { console.error("Exp2A: #exp2aDisplay missing — data stored, nothing rendered."); }

  function show(text) {
    var sel = (dv.variant === "named3") ? selected.slice(0, 3)
            : (dv.variant === "named2") ? selected.slice(0, 2) : [];
    var composed = EXP2A.composeStimulus(text.trim(), sel);
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_reflect_clause", EXP2A.reflectClause(sel));
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_text", composed);
    try {
    if (target) {
      target.innerHTML = composed.split(/\n\s*\n/)
        .filter(function (p) { return p.trim() !== ""; })
        .map(function (p) { return '<p style="margin:0 0 1em 0;">' + p.trim().replace(/\n/g, " ") + "</p>"; })
        .join("");
    }
    } finally { revealEssay(); }
    console.log("Exp2A arm:", arm, "variant:", dv.variant, "n:", pairs.length, "source:", source);
  }

  // Inline fallbacks are byte-identical to tie-generic.txt / placebo.txt so a
  // transient fetch failure cannot hand out a different stimulus class (2B rule).
  var FALLBACK_GENERIC = "Imagine you moved to a new area about four hours away for a job opportunity. You don't know anyone there — no family nearby, no close friends, no neighbors you can count on. The people you'd normally turn to for help are all back where you used to live.\n\nIn a few sentences, describe how your daily life might be different without anyone nearby that you could rely on. What kinds of things would you have to handle differently?";
  var FALLBACK_PLACEBO = "We'd like you to think about your daily routine. Imagine a typical weekday for you — from when you wake up to when you go to sleep.\n\nNow, imagine that you rearranged your morning routine — say, you started waking up an hour earlier than usual and changed the order in which you do things.\n\nIn a few sentences, how do you think your day would feel different?";

  var file = { named3: "tie-named-3.txt", named2: "tie-named-2.txt", generic: "tie-generic.txt", placebo: "placebo.txt" }[dv.variant];
  getText(BASE + "templates/" + file, FETCH_TIMEOUT_MS)
    .then(function (t) {
      // Defense in depth: an unexpected 200 with HTML (misconfigured host,
      // captive portal, moved page) or a template missing its placeholder
      // token is not a usable stimulus either — force the catch/fallback.
      if (t.indexOf("<") !== -1) { throw new Error("Exp2A: fetched template contains '<'"); }
      if ((dv.variant === "named3" || dv.variant === "named2") && t.indexOf("[NAME1]") === -1) {
        throw new Error("Exp2A: fetched template missing [NAME1]");
      }
      show(t);
    })
    .catch(function (e) {
      var reason = (e && e.kind) ? e.kind : "error";
      console.error("Exp2A template fetch failed:", reason, e);
      Qualtrics.SurveyEngine.setEmbeddedData("exp2a_error", reason);
      if (arm === "placebo") { show(FALLBACK_PLACEBO); }
      else {
        dv = { variant: "generic", lowTie: dv.lowTie };
        Qualtrics.SurveyEngine.setEmbeddedData("exp2a_variant", "generic");
        show(FALLBACK_GENERIC);
      }
    });
});
