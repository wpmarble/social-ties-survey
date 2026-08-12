// Dev tool — unit checks for exp2a-core.js. Run: node test-core.js
const assert = require("assert");
const E = require("../exp2a-core.js");

// sanitize: ED-write safety
assert.strictEqual(E.sanitize('Maria "the rock" <b>G'), "Maria the rock b G");
assert.strictEqual(E.sanitize("O'Brien"), "O'Brien");          // apostrophes survive
assert.strictEqual(E.sanitize("a\\b`c"), "a b c");
assert.strictEqual(E.sanitize("line1\nline2\ttab"), "line1 line2 tab");
assert.strictEqual(E.sanitize(null), "");
assert.strictEqual(E.sanitize("  spaced   out  "), "spaced out");

// normalizeEntry: cleanup + usability floor (>= 2 unicode letters)
assert.strictEqual(E.normalizeEntry("  Maria — sister  "), "Maria — sister");
assert.strictEqual(E.normalizeEntry("🙃"), "");
assert.strictEqual(E.normalizeEntry("Maria 🙂"), "Maria");
assert.strictEqual(E.normalizeEntry("q"), "");                 // single letter
assert.strictEqual(E.normalizeEntry("Jo"), "Jo");              // two letters OK
assert.strictEqual(E.normalizeEntry("李伟"), "李伟");            // non-Latin letters count
assert.strictEqual(E.normalizeEntry('"Maria"'), "Maria");      // surrounding quotes
assert.strictEqual(E.normalizeEntry("  "), "");
assert.strictEqual(E.normalizeEntry(undefined), "");

// splitCandidates
assert.deepStrictEqual(E.splitCandidates("Mom and Dad"), ["Mom", "Dad"]);
assert.deepStrictEqual(E.splitCandidates("Maria & James"), ["Maria", "James"]);
assert.deepStrictEqual(E.splitCandidates("Maria"), ["Maria"]);
assert.deepStrictEqual(E.splitCandidates("Sandy"), ["Sandy"]); // no false split on "and" inside a word

console.log("test-core.js: all passed");
