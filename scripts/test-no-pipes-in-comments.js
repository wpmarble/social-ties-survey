// Static test: in every script pasted into Qualtrics, a piped-text token (dollar-brace) may appear ONLY inside a plain
// double-quoted JS string literal, and only the allowlisted intended pipe reads. Qualtrics fills pipes inside comments
// too; a value containing the comment terminator would break the script. Any dollar-brace in a comment, template
// literal, regex, or non-allowlisted string fails.
// Run: node scripts/test-no-pipes-in-comments.js   (exit 0 = all pass)
const fs = require("fs"), path = require("path");

const PASTED = {   // file -> exact multiset of pipe strings allowed (each must be the whole contents of a "..." literal)
  "exp1-ad.js": ["${e://Field/resp_state}", "${e://Field/exp1_tr_arm}", "${e://Field/resp_id}"],
  "exp2b-threat.js": ["${q://QID23/SelectedChoicesRecode}", "${q://QID28/SelectedChoicesRecode}", "${e://Field/exp2b_arm}", "${e://Field/resp_id}"],
  "exp2a-render.js": ["${e://Field/exp2a_arm}", "${e://Field/resp_id}"],
  "exp2a-parse.js": [],
  "exp2a-core.js": [],
  "exp2a-hooks/render-hook.js": ["${e://Field/exp2a_arm}", "${e://Field/resp_id}"],
  "exp2a-hooks/parse-hook.js": [],
};

// Minimal JS lexer: returns tokens {kind: "comment"|"string"|"template"|"regex", text}. Regex literals are detected
// heuristically from the previous significant character.
function lex(src) {
  const toks = []; let i = 0, prev = "", prevWord = "";
  const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { let j = src.indexOf("\n", i); if (j < 0) j = src.length; toks.push({ kind: "comment", text: src.slice(i, j) }); i = j; continue; }
    if (c === "/" && n === "*") { const j = src.indexOf("*/", i + 2); if (j < 0) throw new Error("unterminated block comment"); toks.push({ kind: "comment", text: src.slice(i, j + 2) }); i = j + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; if (src[j] === "\n") throw new Error("newline in string at " + i); j++; }
      toks.push({ kind: "string", text: src.slice(i, j + 1) }); i = j + 1; prev = '"'; prevWord = ""; continue;
    }
    if (c === "`") {
      let j = i + 1; while (j < src.length && src[j] !== "`") { if (src[j] === "\\") j++; j++; }
      toks.push({ kind: "template", text: src.slice(i, j + 1) }); i = j + 1; prev = "`"; continue;
    }
    if (c === "/" && (prev === "" || REGEX_AFTER.indexOf(prev) !== -1 || prevWord === "return")) {
      let j = i + 1, inClass = false;
      while (j < src.length) { const d = src[j]; if (d === "\\") { j += 2; continue; } if (d === "\n") throw new Error("newline in regex at " + i); if (d === "[") inClass = true; else if (d === "]") inClass = false; else if (d === "/" && !inClass) break; j++; }
      toks.push({ kind: "regex", text: src.slice(i, j + 1) }); i = j + 1; prev = ")"; prevWord = ""; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; prevWord = src.slice(i, j); prev = "a"; i = j; continue; }
    prev = c; prevWord = ""; i++;
  }
  return toks;
}

let fails = 0;
const check = (name, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  " + (extra || ""))); if (!ok) fails++; };

for (const [file, allowed] of Object.entries(PASTED)) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf8");
  const toks = lex(src);
  const bad = [], found = [];
  for (const t of toks) {
    if (t.text.indexOf("${") === -1) continue;
    if (t.kind === "string" && t.text[0] === '"' && /^"\$\{[eq]:\/\/[A-Za-z0-9_\/]+\}\.?"$/.test(t.text)) { found.push(t.text.slice(1, -1)); continue; }
    bad.push(t.kind + ": " + t.text.slice(0, 80).replace(/\n/g, " "));
  }
  check(`${file}: no dollar-brace outside allowlisted string literals`, bad.length === 0, bad.join(" | "));
  check(`${file}: intended pipe reads exactly as allowlisted`, JSON.stringify(found.slice().sort()) === JSON.stringify(allowed.slice().sort()), `found ${JSON.stringify(found)}`);
}

// Self-test: the lexer must flag a pipe in a comment and in a template literal, and accept one in a string.
const probe = (s) => lex(s).filter(t => t.text.indexOf("${") !== -1).map(t => t.kind);
check("lexer self-test: pipe in // comment -> comment", JSON.stringify(probe('var a = 1; // see ${e://Field/x}\n')) === '["comment"]');
check("lexer self-test: pipe in /* */ comment -> comment", JSON.stringify(probe('/* ${e://Field/x} */ var a;')) === '["comment"]');
check("lexer self-test: pipe in string -> string", JSON.stringify(probe('var a = "${e://Field/x}".trim();')) === '["string"]');
check("lexer self-test: regex with quote does not derail", JSON.stringify(probe('var r = /"/g; // ${e://Field/x}\n')) === '["comment"]');
console.log(fails ? `FAILED: ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);
