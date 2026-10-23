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
  // "mrs" is deliberately NOT a term: "Mrs. Alvarez the neighbor" is a neighbour. "missus" is.
  // "SO" (uppercase only: "so" is a common word) is handled case-sensitively in hasSpouseTerm via CASE_SENSITIVE_TERMS.
  var SPOUSE_WORDS = ["spouse", "wife", "husband", "partner", "fiance", "fiancee",
    "fiancé", "fiancée", "boyfriend", "girlfriend", "bf", "gf", "hubby", "wifey",
    "significant other", "my other half", "life partner",
    "hubs", "missus", "old lady", "old man", "better half", "other half", "wives", "husbands", "wifes", "partners",
    "girlfriends", "boyfriends", "esposa", "esposo", "marido", "mujer", "novia", "novio", "husbando", "waifu", "bride",
    "groom", "lover",
    "wfie", "wif", "husban", "husbnd", "hubbie", "girlfreind", "girlfrend", "boyfreind", "boyfrend", "fience", "fiacee"];
  var CASE_SENSITIVE_TERMS = ["SO"];
  // Couple emoji: scanned on the RAW text (normalizeEntry strips emoji). A ZWJ followed by a heart marks any couple sequence.
  var SPOUSE_EMOJI = ["\u{1F48D}", "\u{1F491}", "\u{1F48F}", "\u{1F492}", "\u{1F470}", "\u{1F935}"];
  var COUPLE_SEQ_RE = /\u200D[\u2764\u{1F48B}]/u;

  // Endearments are ambiguous (spouse? a friendly "love"?). The PI has not decided whether they mark a spouse entry:
  // flip this ONE flag to true to make the spouse-word scan treat them like spouse terms (exp2a-WIRING section 9).
  var ENDEARMENT_TERMS = ["love", "bae", "sweetheart", "sweetie", "honey", "babe", "darling", "sweetpea", "boo", "baby",
    "\u2764", "\u{1F495}", "\u{1F496}", "\u{1F60D}", "\u{1F497}", "\u{1F493}", "\u{1F49E}", "\u{1F498}", "\u{1F49D}", "\u{1F618}", "\u{1F970}", "\u2665"];
  var EXCLUDE_ENDEARMENTS = false;

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

  // "work partner", "business partner", "lab partner": the modifier makes "partner" non-romantic, so it is NOT a spouse.
  var NONSPOUSE_PARTNER_MODS = ["work", "business", "lab", "carpool", "running", "workout", "gym", "tennis", "climbing", "hiking",
    "study", "dance", "debate", "law", "firm"];
  // "partner at work", "partner at the firm", "partner in a law firm"
  var PARTNER_FOLLOW_NOUNS = ["work", "firm", "law", "company", "office", "practice", "business", "school", "lab"];
  function partnerFollowNonSpouse(toks, i) {
    var j = i + 1;
    if (toks[j] !== "at" && toks[j] !== "in" && toks[j] !== "of") { return false; }
    j++;
    while (toks[j] === "the" || toks[j] === "a" || toks[j] === "an" || toks[j] === "my" || toks[j] === "our") { j++; }
    return PARTNER_FOLLOW_NOUNS.indexOf(toks[j]) !== -1;
  }

  // Placeholder-looking strings are never a name (respondent-typed or LLM), compared case/diacritic-insensitively via lowerKey.
  var NAME_STOPLIST = ["null", "undefined", "true", "false", "nan", "none", "n a", "unknown"];

  var UNUSABLE_EXACT = ["null", "undefined", "true", "false", "nan", "nobody", "no one", "noone", "none", "n a", "na",
    "nothing", "nope", "no", "idk", "i dont know", "dont know", "not sure",
    "myself", "me", "self", "same", "same as above", "see above", "x", "xx",
    "unknown", "not applicable", "no idea"];

  // --- classification helpers ----------------------------------------------
  // Lower-case with diacritics folded (NFD, combining marks stripped); unchanged diacritics if normalize is unavailable.
  // NFKD (full-width -> ASCII, ligatures), format characters (zero-width, soft hyphen) removed, combining marks removed.
  var CF_RE;
  try { CF_RE = new RegExp("\\p{Cf}", "gu"); } catch (e) { CF_RE = /[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g; }
  function foldCase(s) {
    var t = String(s === null || s === undefined ? "" : s);
    try { if (t.normalize) { t = t.normalize("NFKD"); } } catch (e) { /* keep as is */ }
    return t.replace(CF_RE, "").replace(/\p{M}/gu, "");
  }
  function foldKey(s) { return foldCase(s).toLowerCase(); }

  function lowerKey(s) {
    return foldKey(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }

  function isStopName(n) { return NAME_STOPLIST.indexOf(lowerKey(n)) !== -1; }

  // --- spouse-word scan (deterministic safety net; independent of the LLM and of phrasing) ----------------------
  var SCAN_STOPWORDS = ["my", "our", "your", "his", "her", "their", "the", "a", "an", "and", "or", "of", "for", "in", "on",
    "at", "to", "with", "is", "was", "are", "be", "been", "from", "we", "us", "me", "i", "it", "that", "this", "who", "as",
    "by", "s", "years", "year", "yrs", "yr", "married", "ex", "late", "soon", "future", "new", "now", "lol", "law", "crime",
    "together", "engaged", "dating", "lives", "live", "living", "named", "name", "called", "is", "mine", "so"];
  var SCAN_STOP_MAP = null;
  function scanStopMap() {
    if (SCAN_STOP_MAP) { return SCAN_STOP_MAP; }
    var m = {}, i, j, w;
    function add(x) { m[x] = true; }
    for (i = 0; i < SCAN_STOPWORDS.length; i++) { add(SCAN_STOPWORDS[i]); }
    for (w in REL_WORDS) { if (Object.prototype.hasOwnProperty.call(REL_WORDS, w)) { var rp = lowerKey(w).split(" "); for (j = 0; j < rp.length; j++) { add(rp[j]); } } }
    for (i = 0; i < SPOUSE_WORDS.length; i++) { var sp = lowerKey(SPOUSE_WORDS[i]).split(" "); for (j = 0; j < sp.length; j++) { add(sp[j]); } }
    for (i = 0; i < ENDEARMENT_TERMS.length; i++) { if (/[a-z]/.test(ENDEARMENT_TERMS[i])) { add(ENDEARMENT_TERMS[i]); } }
    for (i = 0; i < REL_MODIFIERS.length; i++) { add(REL_MODIFIERS[i]); }
    for (i = 0; i < NAME_STOPLIST.length; i++) { var np = NAME_STOPLIST[i].split(" "); for (j = 0; j < np.length; j++) { add(np[j]); } }
    SCAN_STOP_MAP = m;
    return m;
  }

  // Does the text contain a spouse/partner term as a whole word (case/diacritic-insensitive)? "work/business/lab partner"
  // and "partner in crime" do not count. Endearments count only when EXCLUDE_ENDEARMENTS is true.
  function hasSpouseTerm(raw) {
    var str = String(raw === null || raw === undefined ? "" : raw), e;
    var noVs = str.replace(/\uFE0F/g, "");
    if (COUPLE_SEQ_RE.test(noVs)) { return true; }
    for (e = 0; e < SPOUSE_EMOJI.length; e++) { if (noVs.indexOf(SPOUSE_EMOJI[e]) !== -1) { return true; } }
    if (EXCLUDE_ENDEARMENTS) {
      for (e = 0; e < ENDEARMENT_TERMS.length; e++) { if (!/[a-z]/.test(ENDEARMENT_TERMS[e]) && noVs.indexOf(ENDEARMENT_TERMS[e]) !== -1) { return true; } }
    }
    var cased = foldCase(str).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/);
    for (e = 0; e < cased.length; e++) { if (CASE_SENSITIVE_TERMS.indexOf(cased[e]) !== -1) { return true; } }
    var toks = lowerKey(str).split(" ");
    var terms = SPOUSE_WORDS.concat(EXCLUDE_ENDEARMENTS ? ENDEARMENT_TERMS : []);
    for (var i = 0; i < toks.length; i++) {
      for (var t = 0; t < terms.length; t++) {
        var tk = lowerKey(terms[t]);
        if (tk === "") { continue; }
        var tw = tk.split(" "), ok = true, k;
        for (k = 0; k < tw.length; k++) { if (toks[i + k] !== tw[k]) { ok = false; break; } }
        if (!ok) { continue; }
        if (tw.length === 1 && tw[0] === "partner") {
          if (i > 0 && NONSPOUSE_PARTNER_MODS.indexOf(toks[i - 1]) !== -1) { continue; }
          if (toks[i + 1] === "in" && toks[i + 2] === "crime") { continue; }
          if (partnerFollowNonSpouse(toks, i)) { continue; }
        }
        return true;
      }
    }
    return false;
  }

  // Candidate name tokens of a spouse entry: every token that is not a relationship/spouse/stop word (over-exclusion is
  // acceptable). Folded and lower-case; hyphenated tokens stay whole ("kate-lynn") unless a part is a stop word.
  function candidateNames(raw) {
    var stop = scanStopMap();
    var t = foldKey(raw).replace(/['\u2019]s\b/g, " ").replace(/[^\p{L}'\u2019\- ]/gu, " ");
    var parts = t.split(/\s+/), out = [];
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i].replace(/^[-'\u2019]+|[-'\u2019]+$/g, "");
      if (tok.length < 2) { continue; }
      var sub = tok.split("-"), allOk = true, j;
      for (j = 0; j < sub.length; j++) { if (sub[j].length < 2 || stop[sub[j]] === true) { allOk = false; } }
      if (allOk) { out.push(tok); }
      if (sub.length > 1) { for (j = 0; j < sub.length; j++) { if (sub[j].length >= 2 && stop[sub[j]] !== true) { out.push(sub[j]); } } }
    }
    return out;
  }

  // { spouse: bool, names: [candidate tokens] }
  function scanSpouse(raw) {
    if (!hasSpouseTerm(raw)) { return { spouse: false, names: [] }; }
    return { spouse: true, names: candidateNames(raw) };
  }

  function hasNonSpouseMod(words) {
    for (var i = 0; i < words.length; i++) { if (NONSPOUSE_PARTNER_MODS.indexOf(words[i]) !== -1) { return true; } }
    return false;
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
        if (matched.spouse && matched.word === "partner" && hasNonSpouseMod(kept)) { matched.spouse = false; }
        var informative = [];
        for (var k = 0; k < kept.length; k++) {
          if (["my", "our", "a", "the"].indexOf(kept[k]) === -1) { informative.push(kept[k]); }
        }
        return { rel: informative.concat([matched.word]).join(" "), spouse: matched.spouse };
      }
      if (REL_MODIFIERS.indexOf(words[i]) === -1 && !(NONSPOUSE_PARTNER_MODS.indexOf(words[i]) !== -1 && words[words.length - 1] === "partner")) { return null; }
      kept.push(words[i]);
      i++;
    }
    return null;
  }

  var NAME_TOKEN_RE = /^\p{Lu}[\p{L}'.\u2019-]*$/u;      // capitalized token
  function isRelOrSpouseWord(tok) {
    var k = lowerKey(tok);
    return k !== "" && (Object.prototype.hasOwnProperty.call(REL_WORDS, k) || SPOUSE_WORDS.indexOf(k) !== -1);
  }
  function isNameLike(s) {
    var toks = s.trim().split(/\s+/);
    if (toks.length < 1 || toks.length > 3) { return false; }
    var honorific = HONORIFIC_RE.test(s.trim());
    for (var i = 0; i < toks.length; i++) {
      if (!NAME_TOKEN_RE.test(toks[i])) { return false; }
      if (isRelOrSpouseWord(toks[i]) && !(honorific && i === 0)) { return false; }   // "Wife Kate", "Mom": not a name
    }
    return parseRelPhrase(s) === null;
  }

  var HONORIFIC_RE = /^(Pastor|Father|Rev\.?|Reverend|Dr\.?|Coach|Ms\.?|Mr\.?|Mrs\.?)\s+\p{Lu}[\p{L}'.\u2019-]*$/u;

  // A spouse/partner classification keeps the NAME it saw (if any): the person is excluded by name from every
  // domain downstream (exp2a-WIRING section 9).
  function spouseResult(nameText) {
    var n = nameText ? sanitize(firstNameOf(nameText)) : "";
    return { cls: "spouse", name: null, rel: null, spouseName: n === "" ? null : n };
  }

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
        if (relB.spouse) { return spouseResult(a); }
        // rel side may carry a trailing description ("neighbor across the street"):
        // parseRelPhrase already rejected that, so retry on the first rel word run.
        return { cls: "named_rel", name: firstNameOf(a), rel: relB.rel };
      }
      if (!relB && isNameLike(a)) {
        var relB2 = leadingRelOf(b);
        if (relB2) {
          if (relB2.spouse) { return spouseResult(a); }
          return { cls: "named_rel", name: firstNameOf(a), rel: relB2.rel };
        }
      }
      if (relA && isNameLike(b)) {
        if (relA.spouse) { return spouseResult(b); }
        return { cls: "named_rel", name: firstNameOf(b), rel: relA.rel };
      }
    }

    // 2. "my <rel> <Name>" (no separator)
    m = text.match(/^((?:[Mm]y|[Oo]ur)\s+.+?)\s+(\p{Lu}[\p{L}'.\u2019-]*)$/u);
    if (m) {
      var relLead = parseRelPhrase(m[1]);
      if (relLead && NAME_TOKEN_RE.test(m[2])) {
        if (relLead.spouse) { return spouseResult(m[2]); }
        return { cls: "named_rel", name: m[2], rel: relLead.rel };
      }
    }
    // 3. "<Name> my <rel>" (no separator)
    m = text.match(/^(\p{Lu}[\p{L}'.\u2019-]*)\s+((?:[Mm]y|[Oo]ur)\s+.+)$/u);
    if (m) {
      var relTail = parseRelPhrase(m[2]);
      if (relTail && NAME_TOKEN_RE.test(m[1])) {
        if (relTail.spouse) { return spouseResult(m[1]); }
        return { cls: "named_rel", name: m[1], rel: relTail.rel };
      }
    }

    // 4. whole entry is a rel phrase
    var relWhole = parseRelPhrase(text);
    if (relWhole) {
      if (relWhole.spouse) { return spouseResult(null); }
      return { cls: "rel_only", name: null, rel: relWhole.rel };
    }

    // 5. honorific + surname stays whole ("Pastor Williams"); rel stays null so
    //    the "(your ...)" clause is naturally suppressed.
    if (HONORIFIC_RE.test(text)) { return { cls: "name_only", name: text, rel: null }; }

    // 5b. "<rel word> <Name>" ("Mom Linda", "Aunt Jo"): the name is the second token, never the relationship word
    m = text.match(/^(\p{L}[\p{L}'\u2019]*)\s+(\p{Lu}[\p{L}'.\u2019-]*)$/u);
    if (m && Object.prototype.hasOwnProperty.call(REL_WORDS, lowerKey(m[1])) && !isRelOrSpouseWord(m[2])) {
      return { cls: "named_rel", name: m[2], rel: lowerKey(m[1]) };
    }

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
    while (start < words.length && (REL_MODIFIERS.indexOf(words[start]) !== -1 || NONSPOUSE_PARTNER_MODS.indexOf(words[start]) !== -1)) { start++; }
    var mods = words.slice(0, start);
    for (var len = Math.min(3, words.length - start); len >= 1; len--) {
      var cand = words.slice(start, start + len).join(" ");
      if (cand === "partner" && (hasNonSpouseMod(mods) || partnerFollowNonSpouse(words, start))) { return { rel: "partner", spouse: false }; }
      if (SPOUSE_WORDS.indexOf(cand) !== -1) { return { rel: cand, spouse: true }; }
      if (REL_WORDS[cand]) { return { rel: cand, spouse: false }; }
    }
    return null;
  }

  var CLS_RANK = { named_rel: 3, name_only: 2, rel_only: 1 };

  function nameKey(n) { return foldKey(n).replace(/[^\p{L}]/gu, ""); }

  // Pairs merge across domains ONLY on a matching name. Two relationship-only pairs ("my friend" twice) may be different
  // people, so each keeps its own key (relationship + slot).
  function pairKey(p) {
    if (p.name) { return "n:" + nameKey(p.name); }
    return "r:" + (p.rel || "").toLowerCase() + "|" + ((p.domains && p.domains[0]) || "") + "|" + p.firstIndex;
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
    var pairs = [], residue = [], nSpouse = 0, spouseNames = [];
    for (var i = 0; i < slots.length; i++) {
      // Safety net, before any classification: an entry with a spouse/partner term is a spouse entry, whatever else it says.
      var scan = scanSpouse(slots[i].text);
      if (scan.spouse) {
        nSpouse++;
        for (var sn = 0; sn < scan.names.length; sn++) { spouseNames.push(scan.names[sn]); }
        continue;
      }
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
        if (res.cls === "spouse") { nSpouse++; if (res.spouseName) { spouseNames.push(res.spouseName); } continue; }
        if (res.cls === "residue") {
          // the row separator must never occur inside a row
          var rtext = sanitize(k === 0 && results.length === 1 ? cleaned : cands[k]).replace(/\|\|\|/g, " ").replace(/\s+/g, " ").trim();
          residue.push({ text: rtext, domain: slots[i].domain, index: i });
          continue;
        }
        var pname = res.name ? sanitize(res.name) : null;
        if (pname && isStopName(pname)) { pname = null; }
        var prel = res.rel ? sanitize(res.rel) : null;
        if (!pname && !prel) { continue; }
        pairs.push({
          name: pname, rel: prel,
          cls: pname ? res.cls : "rel_only", domains: [slots[i].domain], firstIndex: i
        });
      }
    }
    var ex = excludeSpouse(dedupePairs(pairs), spouseNames);
    return { pairs: ex.pairs, residue: residue, needsLlm: residue.length > 0, nSpouse: nSpouse, spouseNames: ex.spouseNames };
  }

  // --- spouse names ---------------------------------------------------------------------------------------------------
  // The parse hook writes the spouse names it saw into exp2a_det_pairs as marker entries ({cls:"spouse", name}), so the
  // render hook can exclude those names from LLM-rescued pairs too.
  function spouseMarkers(names) {
    var out = [], seen = {};
    for (var i = 0; i < names.length; i++) {
      var k = nameKey(names[i]);
      if (k === "" || seen[k]) { continue; }
      seen[k] = true;
      out.push({ cls: "spouse", name: names[i], rel: null, domains: [], firstIndex: -1 });
    }
    return out;
  }
  function packDetPairs(out) { return out.pairs.concat(spouseMarkers(out.spouseNames || [])); }

  // Splits spouse markers off a det-pairs array, merges in extraNames, and drops every pair whose name matches one
  // (case-insensitive, any domain). Returns { pairs, spouseNames }.
  function excludeSpouse(pairs, extraNames) {
    var names = [], keys = {}, real = [], i;
    function addName(n) { var k = nameKey(n); if (k !== "" && !keys[k]) { keys[k] = true; names.push(n); } }
    for (i = 0; i < (extraNames || []).length; i++) { addName(extraNames[i]); }
    for (i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p || typeof p !== "object") { continue; }
      if (p.cls === "spouse") { addName(p.name); continue; }
      real.push(p);
    }
    var kept = [];
    for (i = 0; i < real.length; i++) {
      if (real[i].name && keys[nameKey(real[i].name)]) { continue; }
      kept.push(real[i]);
    }
    return { pairs: kept, spouseNames: names };
  }

  // The pairs actually used in the stimulus, as written to exp2a_selected_json for analyst reconstruction.
  function selectedRecords(selected) {
    var out = [];
    for (var i = 0; i < selected.length; i++) {
      var p = selected[i];
      out.push({
        name: p.name || null, rel: p.rel || null, domains: Array.isArray(p.domains) ? p.domains : [],
        firstIndex: p.firstIndex, origin: p.origin === "llm" ? "llm" : "det", match: p.match === "exact" || p.match === "name" ? p.match : null
      });
    }
    return out;
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

  function buildResidueSlotsString(residue) {
    var parts = [];
    for (var i = 0; i < residue.length; i++) { parts.push(String(residue[i].index)); }
    return parts.join(",");
  }

  var LLM_DROP = { spouse_partner: 1, group: 1, unusable: 1 };

  // Parse the exp2a_residue string ("domain: text ||| domain: text ...", exactly what buildResidueString writes) into
  // residue rows. slotsStr is exp2a_residue_slots ("2,5,7", what buildResidueSlotsString writes): the absolute slot
  // index (0-11) of each row, same numbering as a det pair's firstIndex. When it is absent or inconsistent with the
  // rows, the index falls back to domain base + ordinal among that domain's residue rows (exact across domains, only
  // approximate against det pairs in the same domain).
  var DOMAIN_BASE = { transport: 0, job: 3, money: 6, other: 9 };
  var RESIDUE_PART_RE = /^(transport|job|money|other):\s*(.*)$/;
  function parseResidueString(str, slotsStr) {
    var rows = [], seen = { transport: 0, job: 0, money: 0, other: 0 };
    var parts = String(str === null || str === undefined ? "" : str).split(" ||| ");
    for (var i = 0; i < parts.length; i++) {
      var m = RESIDUE_PART_RE.exec(parts[i].trim());
      if (!m) { continue; }
      rows.push({ text: m[2].trim(), domain: m[1], index: DOMAIN_BASE[m[1]] + seen[m[1]] });
      seen[m[1]]++;
    }
    var st = String(slotsStr === null || slotsStr === undefined ? "" : slotsStr).trim();
    if (st !== "") {
      var sp = st.split(","), ok = sp.length === rows.length;
      for (var j = 0; ok && j < sp.length; j++) {
        var n = parseInt(sp[j], 10);
        if (!/^\s*\d+\s*$/.test(sp[j]) || n > 11) { ok = false; }
      }
      if (ok) { for (var q = 0; q < rows.length; q++) { rows[q].index = parseInt(sp[q], 10); } }
    }
    return rows;
  }

  // --- sanitising LLM output ----------------------------------------------------------------------------------------
  var NAME_STRIP_RE, REL_STRIP_RE;
  try {
    NAME_STRIP_RE = new RegExp("[^\\p{L}'\\u2019\\- ]", "gu");
    REL_STRIP_RE = NAME_STRIP_RE;
  } catch (e) {
    NAME_STRIP_RE = /[^A-Za-zÀ-ɏ'’\- ]/g;
    REL_STRIP_RE = NAME_STRIP_RE;
  }
  var LLM_STOP = ["null", "none", "n a", "na", "unknown", "undefined", "true", "false", "nan", "nobody", "no one", "me", "myself"];
  var REL_NOT_RELS = ["true", "false", "a", "an", "the", "your", "my", "our"];
  var NAME_NOT_NAMES = ["my", "our", "your", "the", "a"];

  // Returns a clean first name or null. Non-strings, markup, stoplist words, relationship words, > 20 chars: null.
  function cleanLlmName(v) {
    if (typeof v !== "string" || /[<>&]/.test(v)) { return null; }
    var raw = v.normalize ? v.normalize("NFC") : v;
    if (LLM_STOP.indexOf(lowerKey(raw)) !== -1) { return null; }
    var stripped = raw.replace(NAME_STRIP_RE, " ").replace(/\s+/g, " ").trim();
    if (stripped === "") { return null; }
    var tok = stripped.split(" ")[0].replace(/^[-'’]+|[-'’]+$/g, "");
    if (tok.length < 2 || tok.length > 20) { return null; }
    var low = tok.toLowerCase();
    if (LLM_STOP.indexOf(low) !== -1 || NAME_NOT_NAMES.indexOf(low) !== -1) { return null; }
    if (REL_WORDS[low] || SPOUSE_WORDS.indexOf(low) !== -1) { return null; }
    return tok.charAt(0).toUpperCase() + tok.slice(1);
  }

  // Returns a clean lower-case relationship (leading your/my/our removed) or null.
  function cleanLlmRel(v) {
    if (typeof v !== "string" || /[<>&]/.test(v)) { return null; }
    var raw = v.normalize ? v.normalize("NFC") : v;
    var t = raw.toLowerCase().replace(REL_STRIP_RE, " ").replace(/\s+/g, " ").trim();
    while (/^(?:your|my|our|the|an|a)(?:\s+|$)/.test(t)) { t = t.replace(/^(?:your|my|our|the|an|a)\s*/, ""); }
    if (t === "" || t.length > 30 || REL_NOT_RELS.indexOf(t) !== -1) { return null; }
    if (LLM_STOP.indexOf(t) !== -1 || LLM_STOP.indexOf(lowerKey(raw)) !== -1) { return null; }
    return t;
  }

  function wholeWordIn(needleKey, hayKey) { return needleKey !== "" && (" " + hayKey + " ").indexOf(" " + needleKey + " ") !== -1; }

  var SPOUSE_CATEGORIES = ["spouse", "partner", "spouse partner", "romantic partner"];
  // An LLM entry is a spouse when its category is spouse_partner / spouse / partner / romantic partner, its relationship
  // resolves to a spouse word, or either label contains a spouse term (hasSpouseTerm).
  function llmEntryIsSpouse(e) {
    var rawCat = typeof e.category === "string" ? e.category : "";
    var cat = sanitize(rawCat).toLowerCase();
    if (cat === "spouse_partner" || SPOUSE_CATEGORIES.indexOf(lowerKey(rawCat)) !== -1 || (rawCat !== "" && hasSpouseTerm(rawCat))) { return true; }
    var rel = cleanLlmRel(e.relationship);
    var res = rel ? (parseRelPhrase(rel) || leadingRelOf(rel)) : null;
    if ((res && res.spouse) || (rel && hasSpouseTerm(rel))) { return true; }
    return typeof e.relationship === "string" && hasSpouseTerm(e.relationship);
  }

  // JSON.parse, tolerating ```json fences and prose around the array (first "[" .. last "]").
  function parseLlmJson(raw) {
    var t = String(raw === null || raw === undefined ? "" : raw).replace(/```[A-Za-z]*/g, " ").trim();
    try { return JSON.parse(t); } catch (e1) { /* fall through */ }
    var a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a !== -1 && b > a) { return JSON.parse(t.slice(a, b + 1)); }
    throw new Error("unparseable");
  }

  // Returns { pairs, nLlm }: nLlm = LLM pairs accepted (matched to a residue row, usable, not a spouse name) before dedupe.
  // detRaw may carry the spouse markers the parse hook wrote.
  function mergeLlmDetailed(detRaw, llmRaw, residue) {
    var ex = excludeSpouse(detRaw);
    var detPairs = ex.pairs, spouseNames = ex.spouseNames.slice();
    var entries = null;
    try {
      var parsed = parseLlmJson(llmRaw);
      if (Object.prototype.toString.call(parsed) === "[object Array]") { entries = parsed; }
      else if (parsed && Object.prototype.toString.call(parsed.entries) === "[object Array]") { entries = parsed.entries; }
    } catch (e) { entries = null; }
    if (!entries) { return { pairs: detPairs, nLlm: 0 }; }
    residue = Object.prototype.toString.call(residue) === "[object Array]" ? residue : [];


    // Match each entry to a residue row. Both sides go through lowerKey (case, whitespace, punctuation stripped).
    // (a) normalised text equal to a row not yet claimed by an exact match (domain prefix stripped; as-is as a second
    // try), else (b) the entry's cleaned name occurs as a whole word in the row. A row may be matched by several entries
    // with different names ("my neighbors Bob and Sue"), never twice by the same name. No positional fallback: an entry
    // that matches no row is invented and dropped.
    // Spouse names first, from EVERY entry (before any row matching or drop): an entry whose category is spouse_partner, or
    // whose relationship resolves to a spouse (wordlist or spouse-word scan), excludes its name from every pair.
    var i, j;
    for (i = 0; i < entries.length; i++) {
      var se = entries[i];
      if (!se || typeof se !== "object") { continue; }
      if (llmEntryIsSpouse(se)) {
        var sname = cleanLlmName(se.name);
        if (sname) { spouseNames.push(sname); }
      }
    }
    var rowKeys = [], exactClaimed = [], rowNames = [];
    for (j = 0; j < residue.length; j++) { rowKeys.push(lowerKey(String(residue[j].text === null || residue[j].text === undefined ? "" : residue[j].text))); exactClaimed.push(false); rowNames.push([]); }
    var llmPairs = [];
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e !== "object") { continue; }
      var name = cleanLlmName(e.name), nk = name ? nameKey(name) : "";
      var textStr = typeof e.text === "string" ? e.text : "";
      var keys = [lowerKey(stripDomainPrefix(textStr)), lowerKey(textStr)];
      var row = -1, how = null, c;
      for (c = 0; c < keys.length && row < 0; c++) {
        if (keys[c] === "") { continue; }
        for (j = 0; j < residue.length; j++) {
          if (!exactClaimed[j] && rowKeys[j] === keys[c] && !(nk && rowNames[j].indexOf(nk) !== -1)) { row = j; how = "exact"; exactClaimed[j] = true; break; }
        }
      }
      if (row < 0 && name) {
        var nw = lowerKey(name);
        for (var pass = 0; pass < 2 && row < 0; pass++) {
          for (j = 0; j < residue.length; j++) {
            if (pass === 0 && rowNames[j].length > 0) { continue; }
            if (rowNames[j].indexOf(nk) === -1 && wholeWordIn(nw, rowKeys[j])) { row = j; how = "name"; break; }
          }
        }
      }
      if (row < 0) { continue; }
      // provenance: the name must literally occur (whole word, normalised) in the residue row it was matched to
      if (name && !wholeWordIn(lowerKey(name), rowKeys[row])) { if (how === "exact") { exactClaimed[row] = false; } continue; }
      if (nk) { rowNames[row].push(nk); }

      var cat = typeof e.category === "string" ? sanitize(e.category).toLowerCase() : "";
      var rel = cleanLlmRel(e.relationship);
      var relResolved = rel ? (parseRelPhrase(rel) || leadingRelOf(rel)) : null;
      // a spouse/partner by category OR by relationship wording, even when flagged unusable: its name is excluded everywhere
      if (llmEntryIsSpouse(e)) { continue; }
      if (e.usable !== true || LLM_DROP[cat]) { continue; }
      // Normalise wordlist-resolvable relationships (strips modifiers like "my"); keep others as-is (the LLM may
      // legitimately return rels outside the wordlist).
      if (relResolved) { rel = relResolved.rel; }
      if (!name && !rel) { continue; }
      llmPairs.push({
        name: name, rel: rel,
        cls: name ? (rel ? "named_rel" : "name_only") : "rel_only",
        domains: [residue[row].domain], firstIndex: residue[row].index, origin: "llm", match: how
      });
    }
    var fin = excludeSpouse(detPairs.concat(llmPairs), spouseNames).pairs;
    var nLlm = 0;
    for (i = 0; i < llmPairs.length; i++) { if (fin.indexOf(llmPairs[i]) !== -1) { nLlm++; } }
    return { pairs: dedupePairs(fin), nLlm: nLlm };
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
    buildResidueSlotsString: buildResidueSlotsString,
    packDetPairs: packDetPairs,
    excludeSpouse: excludeSpouse,
    selectedRecords: selectedRecords,
    cleanLlmName: cleanLlmName,
    cleanLlmRel: cleanLlmRel,
    mergeLlm: mergeLlm,
    mergeLlmDetailed: mergeLlmDetailed,
    parseResidueString: parseResidueString,
    nameKey: nameKey,
    scanSpouse: scanSpouse,
    ENDEARMENT_TERMS: ENDEARMENT_TERMS,
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
    // det pairs plus one marker entry per spouse/partner name seen (the render hook excludes those names everywhere)
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_det_pairs", JSON.stringify(EXP2A.packDetPairs(out)));
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_residue", EXP2A.buildResidueString(out.residue));
    // absolute slot index (0-11) of each residue row, same numbering as a det pair's firstIndex
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_residue_slots", EXP2A.buildResidueSlotsString(out.residue));
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_needs_llm", out.needsLlm ? "1" : "0");
    Qualtrics.SurveyEngine.setEmbeddedData("exp2a_llm_status", out.needsLlm ? "" : "skipped");
    console.log("Exp2A parse:", out.pairs.length, "pairs,", out.residue.length, "residue, spouse:", out.nSpouse);
  });
});
