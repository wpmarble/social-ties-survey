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
  assert.ok(/Echo each entry's text back exactly as given, excluding the leading domain label/.test(wb.system), "prompt: echo exactly, excluding the domain label");
  assert.ok(!/WITHOUT the leading domain prefix/.test(wb.system), "prompt must not carry the contradictory second echo sentence");
  assert.strictEqual((wb.system.match(/Echo each entry/g) || []).length, 1, "exactly one echo instruction");
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

// ---- Phase 2d: residue-aware mergeLlm ----
{
  const mkEntry = (text, name, rel, extra) => Object.assign({ text, name, relationship: rel, category: "family", usable: true }, extra || {});
  const det = (name, domain, idx, rel) => ({ name, rel: rel || null, cls: rel ? "named_rel" : "name_only", domains: [domain], firstIndex: idx });
  const row = (text, domain, index) => ({ text, domain, index });
  const names = (arr) => arr.map(p => p.name);

  // parseResidueString: exact buildResidueString format; index = domain base + ordinal within domain
  {
    const rs = E.buildResidueString([{ domain: "transport", text: "maria sister" }, { domain: "money", text: "mike bro" }, { domain: "transport", text: "x y" }, { domain: "other", text: "my ride: or die" }]);
    assert.deepStrictEqual(E.parseResidueString(rs), [
      { text: "maria sister", domain: "transport", index: 0 }, { text: "mike bro", domain: "money", index: 6 },
      { text: "x y", domain: "transport", index: 1 }, { text: "my ride: or die", domain: "other", index: 9 }]);
    assert.deepStrictEqual(E.parseResidueString(""), []);
    assert.deepStrictEqual(E.parseResidueString("garbage ||| job: ok"), [{ text: "ok", domain: "job", index: 3 }]);
  }

  // C1: rescued person in transport must be primed ahead of three "other" deterministic names
  {
    const residue = E.parseResidueString("transport: maria sister");
    const d = [det("Bob", "other", 9), det("Carl", "other", 10), det("Dee", "other", 11)];
    const raw = JSON.stringify([mkEntry("transport: maria sister", "Maria", "sister")]);
    const sel = E.selectPairs(E.mergeLlm(d, raw, residue), 3);
    assert.strictEqual(sel[0].name, "Maria", "C1: Maria primed first");
    assert.strictEqual(sel[0].domains[0], "transport");
  }
  // C2: mike in transport (rescued) and "mike bro" in money (rescued): cross-domain priority
  {
    const residue = E.parseResidueString("transport: mike ||| money: mike bro");
    const d = [det("Ann", "job", 3, "boss"), det("Bea", "job", 4, "friend"), det("Cy", "other", 9, "pal")];
    const raw = JSON.stringify([mkEntry("transport: mike", "Mike", null), mkEntry("money: mike bro", "Mike", "brother")]);
    const merged = E.mergeLlm(d, raw, residue);
    const mike = merged.filter(p => p.name === "Mike");
    assert.strictEqual(mike.length, 1, "C2: Mike deduped");
    assert.deepStrictEqual(mike[0].domains.slice().sort(), ["money", "transport"]);
    assert.strictEqual(E.selectPairs(merged, 3)[0].name, "Mike", "C2: Mike primed first via cross-domain priority");
  }
  // D: a rescued person sorts by real slot, not last
  {
    const residue = E.parseResidueString("transport: zed pal");
    const d = [det("Ann", "job", 3, "boss"), det("Bea", "job", 4, "boss"), det("Cy", "money", 6, "boss")];
    const merged = E.mergeLlm(d, JSON.stringify([mkEntry("zed pal", "Zed", "pal")]), residue);
    assert.strictEqual(E.selectPairs(merged, 3)[0].name, "Zed", "D: rescued transport person sorts first among equal class");
    assert.strictEqual(merged.filter(p => p.name === "Zed")[0].firstIndex, 0);
  }
  // F: a same-domain duplicate must not be promoted to multi-domain
  {
    const residue = E.parseResidueString("transport: mike");
    const d = [det("Mike", "transport", 0), det("Ann", "job", 3, "boss"), det("Bea", "job", 4, "boss"), det("Cy", "money", 6, "boss")];
    const merged = E.mergeLlm(d, JSON.stringify([mkEntry("mike", "Mike", null)]), residue);
    const mike = merged.filter(p => p.name === "Mike");
    assert.strictEqual(mike.length, 1);
    assert.deepStrictEqual(mike[0].domains, ["transport"], "F: no promotion");
    // and Ann (named_rel) outranks name-only Mike, as it would with no LLM at all
    assert.strictEqual(E.selectPairs(merged, 3).map(p => p.name).join(","), E.selectPairs(d, 3).map(p => p.name).join(","));
  }
  // Invented: an LLM entry not in the residue is not counted (counts differ, so no order fallback)
  {
    const residue = E.parseResidueString("job: dana boss");
    const raw = JSON.stringify([mkEntry("job: dana boss", "Dana", "boss"), mkEntry("job: Invented Person", "Invented", "friend")]);
    const r = E.mergeLlmDetailed([], raw, residue);
    assert.deepStrictEqual(names(r.pairs), ["Dana"]);
    assert.strictEqual(r.nLlm, 1);
    assert.strictEqual(E.mergeLlmDetailed([], JSON.stringify([mkEntry("x", "Ghost", "friend")]), []).nLlm, 0, "no residue -> nothing counted");
  }
  // identical texts map to distinct rows (each row used once)
  {
    const residue = [row("mike", "transport", 0), row("mike", "money", 6)];
    const raw = JSON.stringify([mkEntry("mike", "Mike", null), mkEntry("mike", "Mike", null)]);
    const merged = E.mergeLlm([], raw, residue);
    assert.deepStrictEqual(merged[0].domains.slice().sort(), ["money", "transport"], "both rows consumed");
    // three identical entries vs two rows: third has no unused row and counts differ -> dropped
    assert.strictEqual(E.mergeLlmDetailed([], JSON.stringify([mkEntry("mike", "Mike", null), mkEntry("mike", "Mike", null), mkEntry("mike", "Mike", null)]), residue).nLlm, 2);
  }
  // no positional fallback (Phase 2e): an entry that matches no row, by text or by a whole-word name, is dropped
  {
    const residue = [row("my ride or die", "money", 6)];
    const raw = JSON.stringify([mkEntry("paraphrased", "Denise", "friend")]);
    assert.strictEqual(E.mergeLlmDetailed([], raw, residue).nLlm, 0, "equal counts no longer fill by position");
    const ne = E.mergeLlmDetailed([], JSON.stringify([mkEntry("paraphrased", "Denise", "friend"), mkEntry("other", "Eve", "friend")]), residue);
    assert.strictEqual(ne.nLlm, 0);
  }
  // nLlm = 0 for malformed / fenced / [] / no matches
  {
    const residue = [row("a b", "job", 3)];
    for (const raw of ["", "```json\n[]\n```", "[]", "not json", JSON.stringify([mkEntry("zzz", "Q", "friend"), mkEntry("yyy", "R", "friend")])]) {
      assert.strictEqual(E.mergeLlmDetailed([], raw, residue).nLlm, 0, JSON.stringify(raw));
    }
  }
}
console.log("test-core.js: phase2d residue cases ok");

// pairs missing a usable domains array must not throw in selectPairs / dedupePairs
{
  const mk = (name, extra) => Object.assign({ name: name, rel: "friend", cls: "named_rel", firstIndex: 0 }, extra);
  assert.doesNotThrow(() => E.selectPairs([mk("A"), mk("B", { domains: ["job"] }), mk("C", { domains: "x" })], 3));
  assert.doesNotThrow(() => E.dedupePairs([mk("A"), mk("A", { domains: ["job"] })]));
  assert.strictEqual(E.selectPairs([mk("A"), mk("B", { domains: ["job", "money"] })], 3)[0].name, "B", "multi-domain still ranks first");
}
console.log("test-core.js: missing-domains guard ok");
