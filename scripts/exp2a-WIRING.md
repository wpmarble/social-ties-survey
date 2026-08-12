# Exp 2A — wiring into Qualtrics

Survey: `SV_cPhHeZv7u82p9K6` ("Social Ties Survey Summer 2026"). Block:
`BL_82I0C2NV9OA6FPo` ("PLACEHOLDER — Experiment 2, Component A: Social Connection
Scenario"), flow position `FL_14`, immediately after the Political Views block
(`BL_0CYW1xfM3PkZSgS`, `FL_12`) and immediately before the Exp 2B block
(`BL_7Vw8WDh3EL2DNum`, `FL_15`).

This covers **Exp 2A (tie prime + LLM name parsing) only**. Exp 2B (economic threat
prime) is already built, deployed, and wired — see `exp2-WIRING.md`. Full design
rationale: `survey/exp2a-design-spec.md`.

As of this writing (checked live via the Qualtrics API): `FL_30`'s `EmbeddedData`
element holds exactly 13 fields (4 `exp1_*` + 9 `exp2b_*`) — **no `exp2a_*` fields
exist yet**. The Exp 2A block contains exactly one question, `QID51` — a Descriptive
Text/Graphic placeholder (`DataExportTag: exp2a_placeholder`) with boilerplate design
text and no HTML div. `QID45` (`names_other`) is a plain 3-slot text-entry question
with no hidden div and no question JS. No Web Service elements exist anywhere in the
flow (`list_web_services` returns 0). Nothing below is live yet.

Unlike 2B, this design runs real logic at survey time (per-respondent free text can't
be precomputed by an offline R script), so the discipline is: **all logic lives in one
repo-hosted, harness-tested module** (`scripts/exp2a-core.js`), assembled by
`node scripts/exp2a-build.js` into the two scripts that get pasted verbatim into
Qualtrics (`scripts/exp2a-parse.js` on `QID45`, `scripts/exp2a-render.js` on the Exp 2A
display question). **Never hand-edit the generated files** — edit `exp2a-core.js` or
`scripts/exp2a-hooks/*.js` and re-run the build.

---

## 1. Embedded data (`FL_30`)

Add these 18 fields to the existing `FL_30` `EmbeddedData` element (same element that
already holds `exp1_*`/`exp2b_*` — append, no reordering needed). All are **string
fields with no default value**:

```
exp2a_det_pairs
exp2a_residue
exp2a_needs_llm
exp2a_llm_pairs
exp2a_llm_status
exp2a_arm
exp2a_variant
exp2a_name1
exp2a_name2
exp2a_name3
exp2a_rel1
exp2a_rel2
exp2a_rel3
exp2a_n_names
exp2a_low_tie_flag
exp2a_parse_source
exp2a_reflect_clause
exp2a_text
```

Full contents/writer for each field: `exp2a-design-spec.md` §6. This must be live
*before* `QID45`'s page can be reached in preview — declared here, at `FL_30`, well
above `FL_13` (name-gen block) — for the same reason 2B's fields had to sit above
`FL_6`: piped/embedded-data reads from an undeclared field resolve empty, silently.

---

## 2. `QID45` (`names_other`)

`QID45` is the last name-generator page (3 free-text slots, `DataExportTag:
names_other`). Two changes to this question, both in the Qualtrics UI:

**(a) Question HTML** — append this exact block below the existing question text
(source/HTML view, so it renders hidden and doesn't disturb the visible question):

```html
<div id="exp2aPrior" style="display:none">
<span class="exp2a-slot" data-domain="transport">${q://QID43/ChoiceTextEntryValue/1}</span>
<span class="exp2a-slot" data-domain="transport">${q://QID43/ChoiceTextEntryValue/2}</span>
<span class="exp2a-slot" data-domain="transport">${q://QID43/ChoiceTextEntryValue/3}</span>
<span class="exp2a-slot" data-domain="job">${q://QID40/ChoiceTextEntryValue/1}</span>
<span class="exp2a-slot" data-domain="job">${q://QID40/ChoiceTextEntryValue/2}</span>
<span class="exp2a-slot" data-domain="job">${q://QID40/ChoiceTextEntryValue/3}</span>
<span class="exp2a-slot" data-domain="money">${q://QID37/ChoiceTextEntryValue/1}</span>
<span class="exp2a-slot" data-domain="money">${q://QID37/ChoiceTextEntryValue/2}</span>
<span class="exp2a-slot" data-domain="money">${q://QID37/ChoiceTextEntryValue/3}</span>
</div>
```

**Verify each pipe string via the Qualtrics piped-text menu** (Survey editor → rich
content editor → Piped Text → Survey Question → the form field) before pasting —
`ChoiceTextEntryValue/1`/`2`/`3` is the assumed slot order. Checked live: `QID43`
(`names_transport`), `QID40` (`names_job`), and `QID37` (`names_money`) are all TE/FORM
questions with three sub-choices labeled "Person 1/2/3 (first name and relationship)"
in that display order — consistent with the assumption, but the API surface used here
doesn't expose the internal `ChoiceOrder` array that the piped-text menu resolves
against, so this is not itself the confirmation the spec requires. Re-verify by hand.

**(b) Question JS** — paste the full contents of `scripts/exp2a-parse.js` (the
generated file, not `exp2a-core.js` alone) into `QID45`'s JavaScript editor. It reads
the nine hidden spans above plus the three live inputs on the page itself (12 slots
total), runs the deterministic parser, and writes `exp2a_det_pairs`, `exp2a_residue`,
`exp2a_needs_llm`, and `exp2a_llm_status` (`"skipped"` if no residue, else left blank
for the Web Service to fill).

---

## 3. Flow: Branch → Web Service

**STOP — before adding anything from this section to the real survey, complete the §5
throwaway-survey verification below.** §5 determines whether the response mapping in
this section even works as written (the nested-array mapping may need to change to the
`entries_json` fallback) and whether a broken/timed-out call actually lets the flow
continue. Wiring this section into the live survey first, out of the order it appears
in this document, risks a live respondent getting stuck or a mapping that silently
writes nothing.

In the Survey Flow, insert one new element **after** the Political Views block entry
(`BL_0CYW1xfM3PkZSgS`, currently at position `FL_12` in the flow list) and **before**
the Exp 2A block entry (`BL_82I0C2NV9OA6FPo`, `FL_14`) — note the flow list's *array
order* is what matters for execution order, not the `FL_n` numeric suffixes, which are
non-sequential IDs.

Add a **Branch**: `If exp2a_needs_llm Is Equal to 1`, containing one **Web Service**
element inside the branch:

- **Method:** POST `https://api.anthropic.com/v1/messages`
- **Headers:** `x-api-key` (the dedicated key — see §6 below), `anthropic-version:
  2023-06-01`, `content-type: application/json`
- **Body:** the `body` object from `exp2a/webservice-body.json` verbatim — including
  the `${e://Field/exp2a_residue}` pipe embedded in the `messages[0].content` string.
  Do not retype it; copy from the file so the tool schema and system prompt stay
  byte-identical to what the harness's mocked-response tests assume.
- **Response mapping:** `content.0.input.entries` → `exp2a_llm_pairs`; set
  `exp2a_llm_status` = the constant string `"ok"` on the success path only. **A failed
  call must write nothing to `exp2a_llm_status`** — that absence is the failure signal
  the renderer depends on (see §5's continue-on-fail check, and §9 note 3).

`list_web_services` currently returns zero elements for this survey — this is a
from-scratch add, not an edit.

---

## 4. Exp 2A block (`BL_82I0C2NV9OA6FPo`)

- **Repurpose `QID51`** (do not delete/recreate the QID — same pattern as 2B's `QID54`
  and Exp 1's `QID73`): delete its current placeholder text entirely and set the
  question HTML (source/HTML view) to exactly:

  ```html
  <div id="exp2aDisplay"></div>
  <div id="exp2aData" style="display:none">
    <span id="exp2a-det">${e://Field/exp2a_det_pairs}</span>
    <span id="exp2a-llm">${e://Field/exp2a_llm_pairs}</span>
    <span id="exp2a-llmstatus">${e://Field/exp2a_llm_status}</span>
  </div>
  ```

  Both div IDs (`exp2aDisplay`, `exp2aData`) and all three span IDs are read directly
  out of `exp2a-render.js` by `getElementById` — don't rename them.

- Paste the full contents of `scripts/exp2a-render.js` into `QID51`'s JavaScript
  editor. It randomizes the arm (with the 2B-pattern back/refresh re-use guard), merges
  deterministic + LLM pairs, selects and renders, and stores all remaining `exp2a_*`
  fields.

- **Add a new essay text-entry question below `QID51`** in this same block, with
  static question text: *"Please write your response in the box below."* This is the
  reflection prompt's response box — the reflection *instruction* itself (which varies
  by arm and by which names were used) is rendered as the last paragraph of the
  stimulus text by the templates/renderer, not authored as separate question text. This
  is a deliberate deviation from 2B's pattern (spec §5, "Reflection prompt — deliberate
  deviation from 2B") because display logic can't branch on `exp2a_arm`, which is set
  by JS on the same page. WM's call on the new question's `DataExportTag` and on
  whether to force-response it — see §7.

---

## 5. Throwaway-survey Web Service verification (BEFORE any of §3 goes into the real survey)

In a scratch survey, add the same Web Service element (same URL, headers, body from
`exp2a/webservice-body.json`) and confirm:

**(a)** A valid call maps `content.0.input.entries` into embedded data as a JSON
string. **If the nested-array mapping fails** — Qualtrics's response-mapping path
syntax can't reach a nested array inside a tool-use block — change the tool's
`input_schema` to a single string property, `entries_json`, where the model emits the
whole entries array pre-serialized as JSON text inside that one string field, and map
`content.0.input.entries_json` instead. **`EXP2A.mergeLlm` (in `exp2a-core.js`)
already parses either shape** — it does `JSON.parse(llmRaw)` and accepts the result
whether it's a bare array or an object with an `.entries` array property, so no core
code change is needed, only the Web Service element's schema and mapping. If you make
this change, update `exp2a/webservice-body.json`'s `tools[0].input_schema` and
`response_mapping` to match, and note the change here.

**(b)** With the URL deliberately broken, the flow **continues** past the element (the
respondent is not stuck) and the mapped fields (`exp2a_llm_pairs`, `exp2a_llm_status`)
stay empty. This is what makes the renderer's `llmStatus !== "ok"` → `"llm_failed"`
path reachable in production, not just in the harness's mocked tests.

**(c)** Note the observed timeout (design spec §9: belief that Qualtrics times out
around ~30s and continues is from training data, not documentation — confirm the
actual value here). The design doesn't depend on the exact number, but "continues
rather than blocks" must be confirmed, and the number bounds the worst-case respondent
wait at the page transition into the Exp 2A block.

---

## 6. Key hygiene

Create a dedicated workspace in the Anthropic Console with a hard monthly spend cap
(≥ $25 is ample: ≤ ~500 tokens round trip × 2,400 respondents at Haiku pricing is
single-digit dollars even at a 100% trigger rate). Issue one key for this Web Service
only. The key lives in the Web Service element and is visible to anyone with Qualtrics
edit access and to no one else — it never reaches the browser. Rotate/disable the key
after fielding.

---

## 7. Pre-launch checklist

Full-survey preview only — **piped data resolves empty in block-only preview; this has
bitten the project twice** (Exp 1's arm-reuse guard, and again for Exp 2B's
industry/occupation codes). `QID43`/`QID40`/`QID37`/`QID45` all sit several blocks
before the Exp 2A block, so a block-only preview of Exp 2A alone will silently produce
empty residue/pairs and route everyone to `generic`.

- [ ] **Confirm the pasted scripts load without console errors in full-survey
      preview.** `exp2a-core.js` uses ES2018 Unicode-property regex escapes (`\p{L}`,
      `\p{Lu}`, the `/u` flag — e.g. `NAME_TOKEN_RE`, `HONORIFIC_RE`, `lowerKey`,
      `normalizeEntry`'s letter-count check). These are fine in current desktop/mobile
      browsers, but **Qualtrics's own script editor and the JFE (JavaScript Form
      Engine) runtime have not been confirmed to accept them** — this is a carry-over
      flag from Task 2's review, not yet exercised live. If either script fails to
      parse/load, the console will show a syntax error immediately on page load; this
      would silently break parsing (QID45) or rendering (Exp 2A block) for 100% of
      respondents, so treat any console error here as a launch blocker, not a warning.
- [ ] Test paths, all in full-survey preview: 3+ names, exactly 2 names, all-spouse,
      all-blank, joke input, and — by temporarily breaking the Web Service URL — the
      LLM-failure path.
- [ ] Confirm `exp2a_*` fields land correctly in a test response export (all 18 fields
      from §1).
- [ ] Confirm the name-gen questions (`QID43`/`QID40`/`QID37`/`QID45`) were **NOT** set
      to force-response — blank = "can't think of anyone" is by design
      (`exp2a-design-spec.md` §1), unlike the general Exp 2 spec's force-response
      default for other questions.
- [ ] Re-verify the `QID43`/`QID40`/`QID37`/`QID45` slot pipes (§2) if anyone has
      edited those questions since this doc was written — choice order isn't enforced
      by Qualtrics and can drift silently (same class of risk as 2B's crosswalk drift,
      `exp2-WIRING.md` §6).
- [ ] Following the 2B precedent (`exp2-WIRING.md` §10): consider setting `QID51`'s
      replacement and the new essay question to force-response. Not mandated by
      `exp2a-design-spec.md` for this block specifically — WM's call, flagged rather
      than assumed.
- [ ] Open the browser console during a full-survey preview run: confirm `Exp2A
      parse: ... pairs, ... residue, spouse: ...` logs after `QID45`'s page submits,
      and `Exp2A arm: ... variant: ... n: ... source: ...` logs after the Exp 2A block
      renders.
- [ ] Confirm the stimulus text is visibly rendered in `#exp2aDisplay`, not stuck on
      "Loading…" and not blank (blank-but-stored is the same silent-failure class 2B's
      QA checklist called out for `#exp2bDisplay`).

---

## 8. Deploy note

Merging `exp2a-tie-prime` → `main` publishes templates and scripts to the live
GitHub Pages site (`williammarble.com/social-ties-survey/exp2a/...`). **Do not merge
without WM's explicit go**, and do not wire any of the above into the *production*
survey (as opposed to a throwaway scratch survey for §5) until the branch is merged, so
that the `fetch()` calls in `exp2a-render.js` resolve against live template files
rather than 404s that fall back to the inline generic/placebo strings.

---

## 9. Notes for analysis / known behaviors

Three behaviors, surfaced during build-time review (Task 6), that are intentional but
easy to misread in the exported data:

1. **`exp2a_variant = "generic"` after a template-fetch failure does not mean the name
   fields are empty.** If the template `fetch()` fails on the Exp 2A page (network
   blip, Pages outage) after the arm was already randomized to `tie` and names were
   already selected, `exp2a-render.js`'s catch handler overrides `exp2a_variant` to
   `"generic"` and shows the name-free fallback text — but `exp2a_name1`–`3` /
   `exp2a_rel1`–`3` were already written earlier in the same `onload` handler from the
   pre-fallback selection, and are **not** cleared. Analysis must key on
   `exp2a_variant` and `exp2a_text` (what the respondent actually saw), never on the
   presence/absence of name fields alone — a non-empty `exp2a_name1` does not imply the
   respondent saw a personalized stimulus.

2. **When a respondent has more than 3 usable people, deterministically-parsed pairs
   are preferred over LLM-rescued pairs at equal selection priority.** `selectPairs`
   ranks candidates by (i) mentioned in multiple domains, (ii) classification rank
   (named+rel > name-only > rel-only), (iii) first-listed order. LLM-rescued pairs are
   merged in via `mergeLlm(detPairs, llmRaw, [])` — the render hook always passes an
   *empty* residue array as the third argument, so LLM pairs can't be matched back to
   their originating domain/index and fall through to the placeholder `{domain:
   "other", index: 99}`. In practice this means an LLM-rescued pair is never
   "mentioned in multiple domains" and always sorts last within its classification
   tier when there are more than 3 usable candidates to choose from. This was a
   deliberate choice (Task 6 review) favoring high-confidence deterministic
   extractions for respondent-facing text over the LLM's residue-derived guesses; it
   has no effect on arm assignment or the named/generic threshold, only on *which*
   names get shown when more than 3 are available.

3. **`exp2a_llm_status` has exactly two write paths, and a failed call writes
   neither.** The parse hook writes `"skipped"` when there's no residue (no LLM call
   needed) or leaves the field blank when there is residue (awaiting the Web Service).
   The Web Service element writes the literal constant `"ok"` only on a successful
   response. **A failed web service call (timeout, network error, broken URL, malformed
   response) writes nothing** — `exp2a_llm_status` stays blank. The renderer treats
   "needed the LLM but status isn't `ok`" as failure and records this in
   `exp2a_parse_source = "llm_failed"` (as opposed to `"det"` when no LLM was needed,
   or `"det+llm"` on a successful merge). `exp2a_parse_source`, not
   `exp2a_llm_status`, is the field to filter on when asking "did the LLM step
   succeed for this respondent."
