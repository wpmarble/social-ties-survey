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
// and the response mapping (content.0.input.entries_json) assumes a forced tool_use block comes first.
{
  const fs = require("fs"), path = require("path");
  const wb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "webservice-body.json"), "utf8")).body;
  assert.strictEqual(wb.model, "claude-haiku-5-5", "model changed: re-verify sampling-param and tool_choice rules");
  for (const k of ["temperature", "top_p", "top_k"]) assert.ok(!(k in wb), "webservice body must not contain " + k);
  assert.strictEqual(wb.tool_choice && wb.tool_choice.type, "tool");
  assert.strictEqual(wb.tools[0].strict, true);
  assert.ok(wb.max_tokens > 0);
  // Qualtrics maps only scalar leaves, so the tool emits the entries as ONE string, entries_json (not a nested array)
  const props = wb.tools[0].input_schema.properties;
  assert.deepStrictEqual(Object.keys(props), ["entries_json"], "tool schema must expose only entries_json");
  assert.ok(!("entries" in props), "nested entries array cannot be mapped by Qualtrics");
  assert.strictEqual(props.entries_json.type, "string");
  assert.deepStrictEqual(wb.tools[0].input_schema.required, ["entries_json"]);
  assert.ok(/WITHOUT the leading domain prefix/.test(wb.system), "prompt must tell the model to drop the domain prefix");
  const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "exp2a", "webservice-body.json"), "utf8"));
  assert.ok(/content\.0\.input\.entries_json/.test(wf.response_mapping.exp2a_llm_pairs), "response mapping must be content.0.input.entries_json");
}

// mergeLlm on the entries_json payload: the mapped field is the array serialized as TEXT; JSON.parse of it yields the array
{
  const residue = [
    { text: "Maria - sister", domain: "transport", index: 0 },
    { text: "my brother Mike", domain: "job", index: 4 },
    { text: "the church ladies", domain: "other", index: 9 }
  ];
  const entriesJson = '[{"text":"Maria - sister","name":"Maria","relationship":"sister","category":"family","usable":true},' +
    '{"text":"my brother Mike","name":"Mike","relationship":"brother","category":"family","usable":true},' +
    '{"text":"the church ladies","name":null,"relationship":null,"category":"group","usable":false}]';
  assert.ok(Array.isArray(JSON.parse(entriesJson)));
  const m = E.mergeLlm([], entriesJson, residue);
  assert.deepStrictEqual(m.map(p => p.name + "/" + p.rel + "/" + p.domains[0] + "/" + p.firstIndex), ["Maria/sister/transport/0", "Mike/brother/job/4"]);
  // a fenced / non-JSON payload degrades to the deterministic pairs (no throw)
  assert.deepStrictEqual(E.mergeLlm([], "```json\n[]\n```", residue), []);
}

// mergeLlm: the model echoes the domain prefix despite the prompt; matching must strip it (else domain falls back to order/"other")
{
  const residue = [
    { text: "Maria - sister", domain: "job", index: 1 },
    { text: "my brother Mike", domain: "transport", index: 5 }
  ];
  // order is deliberately reversed vs residue so the order fallback would give the WRONG domain
  const raw = JSON.stringify([
    { text: "transport: my brother Mike", name: "Mike", relationship: "brother", category: "family", usable: true },
    { text: "  Job :Maria - sister", name: "Maria", relationship: "sister", category: "family", usable: true }
  ]);
  const m = E.mergeLlm([], raw, residue);
  const mike = m.filter(p => p.name === "Mike")[0], maria = m.filter(p => p.name === "Maria")[0];
  assert.strictEqual(mike.domains[0], "transport");
  assert.strictEqual(mike.firstIndex, 5);
  assert.strictEqual(maria.domains[0], "job");
  // an entry whose own text merely contains a colon later is untouched
  const m2 = E.mergeLlm([], JSON.stringify([{ text: "my boss: Dana", name: "Dana", relationship: "boss", category: "coworker", usable: true }]),
    [{ text: "my boss: Dana", domain: "money", index: 2 }]);
  assert.strictEqual(m2[0].domains[0], "money");
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
