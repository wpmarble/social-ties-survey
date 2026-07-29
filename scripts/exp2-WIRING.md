# Exp 2B — wiring into Qualtrics

Survey: `SV_cPhHeZv7u82p9K6` ("Social Ties Survey Summer 2026"). Block: `BL_7Vw8WDh3EL2DNum`
("PLACEHOLDER - Exp 2B Economic Scenario"), flow position `FL_15`, immediately after the Exp 2A
block (`BL_82I0C2NV9OA6FPo`, `FL_14`).

This covers **Exp 2B (economic threat prime) only**. Exp 2A (tie prime) is a separate block with
its own build and gets its own wiring doc when it's built.

As of this writing (checked live via the Qualtrics API), `BL_7Vw8WDh3EL2DNum` contains exactly one
question, `QID54` — a Descriptive Text/Graphic placeholder (`DataExportTag: exp2b_placeholder`)
with boilerplate design-doc text and no HTML div. Nothing below is live yet.

One script, `exp2b-threat.js`, does everything: randomizes the arm, looks up the respondent's
industry × occupation cell, composes and renders the stimulus, and stores what was shown. **All
routing logic lives in `exp2/build/build_exp2_lookup.R`; the Qualtrics JS applies none of it** — it
only reads two answer codes, indexes a JSON lookup, does string substitution, and renders.

## 1. The stimulus question

- Repurpose `QID54` (or add a new Descriptive Text/Graphic question in this block) as the renderer.
  Follow the Exp 1 pattern already live on `QID73`: the question's HTML/source view holds nothing
  but the target div, and the full script goes in that question's JavaScript editor.
- In the question text (source/HTML view), the div must be exactly:
  ```html
  <div id="exp2bDisplay"></div>
  ```
  This id is read directly out of `exp2b-threat.js` (`document.getElementById("exp2bDisplay")`,
  line 39) — don't improvise a different id, and don't copy Exp 1's `adDisplay`.
- Paste the full contents of `scripts/exp2b-threat.js` into that question's JS editor. No inline
  styles are needed; the renderer wraps each paragraph in its own `<p>` and needs nothing else from
  the question HTML.
- While the fetches are in flight, the div shows a plain "Loading…" placeholder — if a preview gets
  stuck there past a couple seconds, something failed (see QA checklist).

## 2. The reflection prompt — separate question, NOT in the templates

The reflection/essay prompt that follows the stimulus is a **separate Qualtrics question**,
authored directly in the Qualtrics UI, placed **below** the stimulus question in this same block.
It is deliberately not part of `exp2/templates/` — the design spec (§4) calls this out explicitly:
"The reflection prompt is NOT part of the stimulus." Confirmed by reading every file in
`exp2/templates/`: none of `lede.txt`, `stat-churn.txt`, `stat-decline.txt`, `stat-generic.txt`, or
`placebo.txt` contains anything resembling a reflection/essay prompt.

The block currently has only the one (placeholder) question, so this reflection question does not
exist yet — it needs to be created, not just repositioned.

## 3. Declare embedded data (Survey Flow, above `FL_14`)

`exp2b-threat.js` writes exactly nine embedded-data fields (verified by reading the script, not
copied from the design spec without checking — the spec's §6 table also lists `exp2a_*` fields that
don't apply here, since Exp 2A isn't built):

| Field | Set when | Contents |
|---|---|---|
| `exp2b_arm` | on load, both arms | `threat` \| `placebo` |
| `exp2b_ind_code` | on load, both arms | resolved industry code as a string, `"0"` if missing/unparseable |
| `exp2b_occ_code` | on load, both arms | resolved occupation code as a string, `"0"` if missing/unparseable |
| `exp2b_text` | after render, both arms | the full stimulus text shown to this respondent |
| `exp2b_frame` | after render, both arms | `churn_decline` \| `churn` \| `decline` \| `generic` for the threat arm; literally `"placebo"` for the placebo arm |
| `exp2b_churn_pct` | after render, threat arm only | churn figure shown, blank otherwise |
| `exp2b_decline_pct` | after render, threat arm only | projection figure shown, blank otherwise |
| `exp2b_churn_unit` | after render, threat arm only | industry named in the churn sentence, blank otherwise |
| `exp2b_decline_unit` | after render, threat arm only | industry or occupation named in the decline sentence, blank otherwise |

Note `exp2b_frame` takes the value `"placebo"` for placebo respondents — the design spec's §6 table
only lists the four threat-arm frame values, so don't be surprised when placebo rows show something
else in the export; that's correct, not a bug.

`exp2b_ind_code`/`exp2b_occ_code` are stored for **every** respondent regardless of arm (useful for
balance checks even though the placebo arm never uses them).

**Where to add them:** checked live via the Qualtrics API — the Survey Flow currently has an
`EmbeddedData` element at `FL_30` sitting right after the Consent block (`FL_2`), holding the four
`exp1_*` fields. That is already well above `FL_6` (Background – Work, where `QID23`/`QID28` live)
and above `FL_14`/`FL_15`. Add the nine `exp2b_*` fields (blank values) to this same `FL_30`
element — no reordering needed, just append.

## 4. The whole-survey-preview requirement

`QID23` (industry, 21 choices) and `QID28` (occupation, 23 choices) live in `BL_3jxLg2NNULjNF78`
("Background – Work", `FL_6`) — a full eight flow elements before the Exp 2B block. The renderer
reads them via `${q://QID23/SelectedChoicesRecode}` / `${q://QID28/SelectedChoicesRecode}` and
parses the result with:

```js
function code(raw, max) {
  const n = parseInt(String(raw).trim(), 10);
  if (isNaN(n) || n < 1 || n > max) { return 0; }
  return n;
}
```

**If you preview only the Exp 2B block**, `QID23`/`QID28` were never answered, the piped text
resolves to an empty/unresolved token, `parseInt` returns `NaN`, and `code()` returns `0` for both
codes — every single respondent in that preview silently gets the `generic` fallback, with no error
of any kind. **Preview the whole survey**, not the block.

This exact class of bug already bit Exp 1 once — `exp1-WIRING.md` §2: Exp 1's embedded-data fields
(`exp1_tr_arm` etc.) are likewise declared in an earlier block, so previewing only the Exp 1 block
skips the declaration and "the arm-reuse guard won't resolve." (`exp1-WIRING.md` §3 is a different,
unrelated bug — a Qualtrics drill-down exceeding the 2,000-permutation limit for piped text — not
this one.) The design spec calls the earlier-block-preview issue out again by name for Exp 2
(§10: "embedded data declared in earlier blocks does not exist in block-only preview"). Say it plainly: this will happen again if
skipped.

## 5. How to change the data

- Re-run `exp2/build/build_exp2_lookup.R`. It needs read access to
  `~/Dropbox/interal-migration/data-internal/economic_shock/` (JOLTS layoff series + BLS
  projections) — that directory lives outside this repo, so it must be present on whatever machine
  runs the build.
- **Read the printed frame distribution** before pushing anything. The script prints, in order: the
  unweighted 483-cell frame count, the employment-weighted frame distribution (see caveat below —
  it excludes some cells), the unweighted composition of the excluded cells, and a per-industry
  breakdown. This is the number the PAP needs for expected cell sizes (spec §9) — inspect it, don't
  just check the exit code.
- Push the regenerated `exp2/exp2_lookup.json`. **Never edit `exp2b-threat.js`** — it contains zero
  routing logic; every threshold, fallback, and label decision lives in the R script and its
  crosswalks.
- The build script's `stopifnot()` assertions are the safety net, and they've been adversarially
  tested: an independent review ran a full mutation suite against the script (deliberately
  reintroducing join breaks, an unsigned-decline bug, a row-misalignment bug, and a
  one-in-N/churn_pct decoupling bug) and confirmed every mutant is caught with a non-zero exit
  (`.superpowers/sdd/2026-07-28-exp2b-implementation/task-4-report.md`, "Addendum 2: round-2
  hardening"). If the script exits 0, trust the JSON.

## 6. Crosswalks — the one QA step that cannot be automated

`industry_xwalk.csv` and `occupation_xwalk.csv` carry the survey answer text (`industry_survey` /
`occ_survey`) alongside a `choice_value` integer that the build script assumes lines up with the
live Qualtrics `QID23`/`QID28` choice order. **The build script has no Qualtrics API credentials and
cannot check this itself** — it's stated directly in the script's own header comment ("this script
does not call the Qualtrics API to verify that industry_xwalk.csv / occupation_xwalk.csv still
match the live survey's choice values and ordering. That check is done manually at survey launch").

As of this writing, checked live via the Qualtrics API: `QID23`'s 21 choices and `QID28`'s 23
choices match `industry_xwalk.csv`/`occupation_xwalk.csv` verbatim, in order, and both questions'
`RecodeValues` are the identity map (choice *N* recodes to integer *N*), which is what
`exp2b-threat.js` assumes. **This can silently drift** — nothing in Qualtrics enforces that choice
order stays fixed, and if anyone reorders, inserts, or edits a choice in `QID23`/`QID28` after this
check, every downstream assignment silently points at the wrong industry or occupation, with no
error anywhere. **Re-verify the crosswalk text against the live choices by hand immediately before
launch, not just once during development.** A silent crosswalk drift would show respondents
statistics about the wrong industry — this is the QA item most likely to be skipped because nothing
will flag it, so don't skip it.

## 7. Known caveats (unresolved / read before treating any of this as final)

- **The employment-weighted frame distribution excludes ~13.5% of cells, and they're not a random
  slice.** Re-ran the build script directly to check this rather than trust the spec's number: 65 of
  483 cells (13.5%) have no BLS employment weight — these are the cells touching Government or a
  write-in "Other" industry/occupation, neither of which has a national employment figure in the BLS
  tables used. Confirmed the skew: unweighted, `generic` is 7.9% of all 483 cells, but it's 30.8% of
  just the 65 excluded cells. **The weighted percentages the build script prints are conditional on
  the 418 weighted cells, not an unconditional full-sample share** — the script's own console output
  says this, but it's easy to miss.
- **Four industry labels currently name a narrower category than the JOLTS number they quote —
  under review by the researcher, may change.** Checked directly against
  `industry_xwalk.csv`'s `industry_code` column and the build script's output:
  - Utilities (choice 3) shares JOLTS code `480099` with Transportation (choice 8) — both show the
    same 18% churn figure, but "the utilities industry" is narrower than the JOLTS aggregate
    ("Transportation, warehousing, and utilities") that number actually describes.
  - Professional/technical services (12), Corporate management (13), **and Administrative and
    support services (14)** all share JOLTS code `540099` and all show the same 22% churn figure —
    the aggregate is "Professional and business services," and all three survey labels name a
    narrower slice of it.

  Note this is **four** industries across two aggregates, not three — Administrative and support
  services (14) shows the identical pattern to Corporate management and Professional/technical
  (confirmed by rerunning the build script; all three print `"22"` for `churn`), and it's already
  named alongside them in `task-1-report.md` and `task-4-report.md` as part of the same
  aggregate-mapping decision. Flagging this as unresolved rather than final either way — the
  researcher may decide to relabel, split, or accept the aggregation for any subset of these.

## 8. Offline harness

`node scripts/exp2b-verify.js` is a dev-only tool — never loaded by Qualtrics — that renders all
21 × 23 = 483 cells from `exp2_lookup.json` locally using the same composition logic as the live
renderer, and checks for unfilled `[TOKEN]` placeholders, doubled/stray spacing, and literal
`"undefined"` strings.

A clean run looks like:

```
$ node scripts/exp2b-verify.js
rendered 483 cells { generic: 38, decline: 8, churn_decline: 114, churn: 323 }
...
all cells rendered cleanly
```

Exit code `0` and no `UNFILLED` / `SPACING` / `UNDEF` lines printed above the summary. If the frame
counts differ from `{ generic: 38, decline: 8, churn_decline: 114, churn: 323 }`, that's expected
after re-running the R build on updated data — it's not itself a failure signal, just confirm the
harness still exits clean and re-read the printed distribution (§5).

Run this after every rebuild of `exp2_lookup.json`, before pushing.

## 9. Files

- Lookup table: `exp2/exp2_lookup.json` → live at
  `https://williammarble.com/social-ties-survey/exp2/exp2_lookup.json`
- Templates: `exp2/templates/{lede,stat-churn,stat-decline,stat-generic,placebo}.txt` → live at
  `https://williammarble.com/social-ties-survey/exp2/templates/<name>.txt`
- Script: `scripts/exp2b-threat.js`
- Build: `exp2/build/build_exp2_lookup.R` (+ `exp2/build/exp2_churn.R`, `exp2/industry_xwalk.csv`,
  `exp2/occupation_xwalk.csv`)
- Offline harness: `scripts/exp2b-verify.js`

## 10. QA checklist before launch

- [ ] **Manually re-verify `industry_xwalk.csv`/`occupation_xwalk.csv` text against the live
      `QID23`/`QID28` choices** (§6). Cannot be automated — the build script has no API credentials.
      Do this last, immediately before launch, not just once during development.
- [ ] Preview the **whole survey**, not the Exp 2B block (§4).
- [ ] Open the browser console. Confirm `Exp2B arm: ... ind: ... occ: ...` logs on load, and
      `Exp2B frame: ...` followed by the full text logs after render.
- [ ] Confirm the div never gets stuck on "Loading…".
- [ ] No literal `[CHURN_UNIT]`, `[CHURN_PCT]`, `[CHURN_CLAUSE]`, `[DECLINE_UNIT]`, or
      `[DECLINE_PCT]` visible anywhere in the rendered text.
- [ ] Reload the preview repeatedly — confirm both arms appear (`threat` and `placebo`), and across
      enough reloads, all four threat frames appear (`churn`, `churn_decline`, `decline`,
      `generic`) — not just the common `churn` case.
- [ ] Confirm the placebo arm renders the commute/errand prompt (`templates/placebo.txt`'s text),
      not any statistic sentence.
- [ ] Confirm all nine `exp2b_*` fields (§3) populate correctly in the response export, including
      for placebo rows (`exp2b_frame` = `"placebo"`, the four numeric/unit fields blank).
- [ ] Confirm the reflection-prompt question (§2) is present, appears below the stimulus, and was
      authored directly in Qualtrics — not accidentally left out because it isn't in the templates.
- [ ] Set `QID23`, `QID28`, `QID54`'s replacement, and the reflection question to **force-response**
      per the design spec (§7) — checked live and none of these currently has any validation set, so
      this still needs to be turned on, not just assumed.
- [ ] Run `node scripts/exp2b-verify.js` (§8) — expect a clean exit with no `UNFILLED`/`SPACING`/
      `UNDEF` lines.
