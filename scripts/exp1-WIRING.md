# Exp 1 — wiring into Qualtrics

Survey: `SV_cPhHeZv7u82p9K6` ("Social Ties Survey Summer 2026").

## 1. Declare embedded data (Survey Flow, ABOVE the Exp 1 block)

Add an Embedded Data element near the top of the survey flow with these fields
(leave values blank — the JS sets them):

- `tr_arm`          — assigned arm (`anti-baseline` | `anti-fiscal` | `anti-crowdout` | `control-valence`)
- `treatment_text`  — full assembled ad the respondent saw (for the data record)
- `candidate_name`  — "Mark Anderson" (set by JS; declared so it exports)
- `candidate_last`  — "Anderson"

**Dependency / KNOWN TODO:** the ads use the respondent's state via
`${e://Field/resp_state}`. **This does not work yet.** State/county is currently
collected with a Qualtrics *drill-down* question, and drill downs with >2,000
answer permutations cannot be used in piped text, display logic, or carry
forward — so `resp_state` is not pipeable as-is. Until this is fixed, [STATE]
falls back to the generic "your state" (graceful, but reads slightly awkwardly
in the control, e.g. "right here in your state").

Fix options (later):
  1. Replace the drill-down with a plain state dropdown (51 options incl. DC),
     then get county via 51 branching conditions or a follow-up — piping works.
  2. Ask ZIP first, then a ZIP→county lookup, only asking directly when the ZIP
     is ambiguous. Fewer permutations, pipeable.
Once fixed, set the field name to `resp_state` (or update the two `resp_state`
references in `exp1-randomizer.js` and `exp1-renderer.js`).

## 2. Two questions, in this order, inside the Exp 1 block

**Q_A — hidden randomizer** (any question type; a Text/Graphic "Descriptive
Text" question works well since it has no answer):
- Paste `exp1-randomizer.js` into the question's JavaScript editor.
- It hides itself, shows a spinner, randomizes + stores the arm, fetches +
  fills the ad, stores `treatment_text`, and auto-advances. Respondent sees
  only a brief spinner.

**Q_B — treatment / ad question** (the one the respondent actually reads):
- In the question text (HTML view), place the target div where the ad should appear:
  ```html
  <div id="adDisplay" style="max-width:640px; margin:0 auto; text-align:left; font-size:1.05em; line-height:1.5;"></div>
  ```
- Paste `exp1-renderer.js` into this question's JavaScript editor.
- It re-fetches the assigned arm, fills placeholders, writes the ad into
  `#adDisplay` as paragraphs, and holds the Next button for 7s (`READ_DELAY_MS`).
- You can put the DV (vote choice) on this same page below the div, or on the
  next page — either works since `tr_arm`/`treatment_text` are already stored.

## 3. Why two scripts instead of piping `${e://Field/treatment_text}`

Piping the assembled ad into question text drops paragraph breaks, and reading a
multi-line embedded value into a JS `"..."` string is a syntax error. The
renderer re-fetches the file and reads only single-line fields (arm, name,
state) via piping, which is safe. `treatment_text` is still stored by the
randomizer for the dataset.

## 4. Files

- Ad text: `exp1/{anti-baseline,anti-fiscal,anti-crowdout,control-valence}.txt`
  → live at `https://williammarble.com/social-ties-survey/exp1/<name>.txt`
- Scripts: `scripts/exp1-randomizer.js`, `scripts/exp1-renderer.js`

## 5. QA checklist before launch

- [ ] Preview survey; open browser console — confirm `Exp1 arm:` logs and the
      assembled ad prints with name/state filled and **no** `[PLACEHOLDER]` left.
- [ ] Run the preview several times — confirm all 4 arms appear.
- [ ] Confirm the ad renders as 3 paragraphs in `#adDisplay` (not a run-on block).
- [ ] Confirm `tr_arm` and `treatment_text` show up in the response data.
- [ ] Confirm `resp_state` actually fills (or intentionally falls back).
