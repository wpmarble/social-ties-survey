# Exp 1 — wiring into Qualtrics

Survey: `SV_cPhHeZv7u82p9K6` ("Social Ties Survey Summer 2026").

**Design (updated 2026-07-21): ONE script on the treatment question.**
`exp1-ad.js` randomizes, fetches, fills, renders, and stores everything in a
single `addOnload`. This replaces the old two-script split
(`exp1-randomizer.js` + `exp1-renderer.js`), which broke because the assigned
arm was round-tripped through piped embedded data (`${e://Field/exp1_tr_arm}`)
and came back **empty** on the treatment page → fetched `/exp1/.txt` → 404.
The single-script version keeps the arm in a JS variable, so nothing is piped
across pages.

## 1. One question: the treatment / ad question

- In the question text (HTML/"Rich Content" view, source mode), place the target
  div where the ad should appear:
  ```html
  <div id="adDisplay" style="max-width:640px; margin:0 auto; text-align:left; font-size:1.05em; line-height:1.5;"></div>
  ```
- Paste `exp1-ad.js` into this question's JavaScript editor.
- It randomizes the arm (equal allocation over 4), stores `exp1_tr_arm` /
  `exp1_candidate_name` / `exp1_candidate_last` / `exp1_treatment_text`, fetches
  the arm's text, fills placeholders, renders the ad into `#adDisplay` as
  paragraphs, and holds the Next button for 7s (`READ_DELAY_MS`) after the ad
  appears.
- Put the DV (vote choice) on this same page below the div, or on the next page
  — either works; `exp1_*` are stored before the respondent can advance.
- **Delete / empty the old hidden randomizer question** if you already made one.

## 2. Declare embedded data (Survey Flow, ABOVE the Exp 1 block)

Add an Embedded Data element with these fields (leave values blank). With the
single-script design this is **for data export, not for rendering** — the ad
renders even if you forget — but declare them so the values reliably appear in
the response download:

- `exp1_tr_arm`          — assigned arm (`anti-baseline` | `anti-fiscal` | `anti-crowdout` | `control-valence`)
- `exp1_treatment_text`  — full assembled ad the respondent saw
- `exp1_candidate_name`  — "Mark Anderson"
- `exp1_candidate_last`  — "Anderson"

## 3. State dependency / KNOWN TODO

The ads use the respondent's state via `${e://Field/resp_state}` (single-line
pipe — safe to read this way). **Not wired yet:** state/county is collected with
a Qualtrics *drill-down*, and drill downs with >2,000 answer permutations can't
be used in piped text / display logic / carry-forward, so `resp_state` isn't
pipeable as-is. Until fixed, [STATE] falls back to the generic "your state"
(graceful, but reads slightly awkwardly in the control, e.g. "right here in your
state").

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
- Script: `scripts/exp1-ad.js`  ← paste this one into the treatment question
- Deprecated (kept for reference only): `scripts/exp1-randomizer.js`,
  `scripts/exp1-renderer.js` — the two-script split that hit the empty-pipe 404.

## 5. QA checklist before launch

- [ ] Preview; open browser console — confirm `Exp1 arm:` logs and the assembled
      ad prints with name/state filled and **no** `[PLACEHOLDER]` left.
- [ ] Confirm the ad actually renders in `#adDisplay` as 3 paragraphs (not a
      run-on block, not the "Loading…" placeholder stuck on screen).
- [ ] Reload the preview several times — confirm all 4 arms appear.
- [ ] Confirm `exp1_tr_arm` and `exp1_treatment_text` show up in the response data.
- [ ] Confirm `resp_state` fills (or intentionally falls back to "your state").
- [ ] Confirm the Next button reappears ~7s after the ad loads.
