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
assert.strictEqual(E.normalizeEntry("A".repeat(200)), ""); // I5: length cap, no legitimate entry is this long

// splitCandidates
assert.deepStrictEqual(E.splitCandidates("Mom and Dad"), ["Mom", "Dad"]);
assert.deepStrictEqual(E.splitCandidates("Maria & James"), ["Maria", "James"]);
assert.deepStrictEqual(E.splitCandidates("Maria"), ["Maria"]);
assert.deepStrictEqual(E.splitCandidates("Sandy"), ["Sandy"]); // no false split on "and" inside a word

// webservice-body.json: Haiku 5.5 on anthropic-version 2023-06-01 returns 400 for sampling params,
// and the response mapping (content.0.input.entries) assumes a forced tool_use block comes first.
{
  const fs = require("fs"), path = require("path");
  const wb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "webservice-body.json"), "utf8")).body;
  assert.strictEqual(wb.model, "claude-haiku-5-5", "model changed: re-verify sampling-param and tool_choice rules");
  for (const k of ["temperature", "top_p", "top_k"]) assert.ok(!(k in wb), "webservice body must not contain " + k);
  assert.strictEqual(wb.tool_choice && wb.tool_choice.type, "tool");
  assert.strictEqual(wb.tools[0].strict, true);
  assert.ok(wb.max_tokens > 0);
}

console.log("test-core.js: all passed");

// pairs missing a usable domains array must not throw in selectPairs / dedupePairs
{
  const mk = (name, extra) => Object.assign({ name: name, rel: "friend", cls: "named_rel", firstIndex: 0 }, extra);
  assert.doesNotThrow(() => E.selectPairs([mk("A"), mk("B", { domains: ["job"] }), mk("C", { domains: "x" })], 3));
  assert.doesNotThrow(() => E.dedupePairs([mk("A"), mk("A", { domains: ["job"] })]));
  assert.strictEqual(E.selectPairs([mk("A"), mk("B", { domains: ["job", "money"] })], 3)[0].name, "B", "multi-domain still ranks first");
}
console.log("test-core.js: missing-domains guard ok");
