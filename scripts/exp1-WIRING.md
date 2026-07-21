# Exp 1 — wiring into Qualtrics

Survey: `SV_cPhHeZv7u82p9K6` ("Social Ties Survey Summer 2026").

One script, `exp1-ad.js`, on the treatment question does everything:
randomizes the arm, fetches + fills the ad text, renders it, and stores the
assignment.

## 1. The treatment / ad question

- In the question text (source/HTML view), place the target div where the ad
  should appear:
  ```html
  <div id="adDisplay" style="max-width:640px; margin:0 auto; text-align:left; font-size:1.05em; line-height:1.5;"></div>
  ```
- Paste `exp1-ad.js` into this question's JavaScript editor.
- It randomizes the arm (equal allocation over 4), stores `exp1_tr_arm` /
  `exp1_candidate_name` / `exp1_candidate_last` / `exp1_treatment_text`, fetches
  the arm's text, fills placeholders, renders the ad into `#adDisplay` as
  paragraphs, and holds the Next button for 7s (`READ_DELAY_MS`) after the ad
  appears.
- Put the DV (vote choice) on this same page below the div, or on the next page.

## 2. Declare embedded data (Survey Flow, ABOVE the Exp 1 block)

Add an Embedded Data element with these fields (leave values blank). Declaring
them ensures the JS-set values appear in the response export:

- `exp1_tr_arm`          — assigned arm (`anti-baseline` | `anti-fiscal` | `anti-crowdout` | `control-valence`)
- `exp1_treatment_text`  — full assembled ad the respondent saw
- `exp1_candidate_name`  — "Mark Anderson"
- `exp1_candidate_last`  — "Anderson"

Note: these live in an earlier block, so **preview the whole survey**, not just
the Exp 1 block — a block-only preview skips the declaration and the arm-reuse
guard won't resolve.

## 3. State dependency / KNOWN TODO

The ads fill [STATE] from `${e://Field/resp_state}`. **Not wired yet:**
state/county is collected with a Qualtrics *drill-down*, and drill downs with
>2,000 answer permutations can't be used in piped text / display logic /
carry-forward, so `resp_state` isn't pipeable as-is. Until fixed, [STATE] falls
back to "your state" (graceful, but reads slightly awkwardly in the control,
e.g. "right here in your state").

Fix options (later):
  1. Replace the drill-down with a plain state dropdown (51 incl. DC), then get
     county via branching or a follow-up — piping works.
  2. Ask ZIP first, then a ZIP→county lookup, only asking directly when the ZIP
     is ambiguous. Fewer permutations, pipeable.
Once fixed, expose the state as embedded data named `resp_state` (or update the
`resp_state` reference in `exp1-ad.js`).

## 4. Files

- Ad text: `exp1/{anti-baseline,anti-fiscal,anti-crowdout,control-valence}.txt`
  → live at `https://williammarble.com/social-ties-survey/exp1/<name>.txt`
- Script: `scripts/exp1-ad.js`

## 5. QA checklist before launch

- [ ] Preview the **whole survey**; open browser console — confirm `Exp1 arm:`
      logs and the assembled ad prints with name/state filled and **no**
      `[PLACEHOLDER]` left.
- [ ] Confirm the ad renders in `#adDisplay` as 3 paragraphs (not a run-on
      block, not stuck on "Loading…").
- [ ] Reload the preview several times — confirm all 4 arms appear.
- [ ] Confirm `exp1_tr_arm` and `exp1_treatment_text` show up in the response data.
- [ ] Confirm `resp_state` fills (or intentionally falls back to "your state").
- [ ] Confirm the Next button reappears ~7s after the ad loads.
