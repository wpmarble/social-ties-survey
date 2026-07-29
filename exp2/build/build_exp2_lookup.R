# Builds exp2_lookup.json — every industry x occupation cell resolved to one
# stimulus. ALL routing logic lives here; the Qualtrics JS has none.
# Re-run after any data change, inspect the printed distribution, push the JSON.
#
# NOTE on crosswalk drift: this script does not call the Qualtrics API to
# verify that industry_xwalk.csv / occupation_xwalk.csv still match the live
# survey's choice values and ordering. That check is done manually at survey
# launch, not automatically here (tracked as a separate QA item).
suppressMessages(library(tidyverse))
suppressMessages(library(jsonlite))
filter <- dplyr::filter
select <- dplyr::select

PROJ  <- path.expand("~/Dropbox/interal-migration")
SHOCK <- file.path(PROJ, "data-internal/economic_shock")   # internal data, outside the repo
OUT   <- file.path(PROJ, "survey/public-survey-files/exp2")
BUILD <- file.path(OUT, "build")
source(file.path(BUILD, "exp2_churn.R"))

# ---- Crosswalks -------------------------------------------------------------
ind_xw <- read_csv(file.path(OUT, "industry_xwalk.csv"),   show_col_types = FALSE)
occ_xw <- read_csv(file.path(OUT, "occupation_xwalk.csv"), show_col_types = FALSE)
# NB: read_csv parses choice_value as double, not integer, so compare against
# as.numeric(1:21)/1:23 rather than the bare integer literals (identical() is
# type-strict and the brief's literal 1:21 comparison fails on real output).
stopifnot(identical(sort(ind_xw$choice_value), as.numeric(1:21)),
          identical(sort(occ_xw$choice_value), as.numeric(1:23)))

# ---- Annual churn by JOLTS industry code ------------------------------------
# n_distinct(period), not n(): duplicated months for a code would still pass
# a bare row-count check even though the series is not actually 12 distinct
# monthly observations.
churn_raw <- read_csv(file.path(SHOCK, "jt_layoff_clean.csv"), show_col_types = FALSE)

# I2: `year == 2025` below is hardcoded because the stimulus copy says "last
# year" (correct as of this writing). Nothing else would warn if new data
# lands and this goes stale, so fail loudly instead. NB: a naive
# `max(year) == 2025` is too strict for this data source in practice — this
# JOLTS extract already carries a few months of the in-progress current year
# before that year is usable (checked directly against the raw file: as of
# this build, 2026 has only 4 of 12 months present, for a subset of industry
# codes, so it correctly falls out of the `n_distinct(period) == 12` filter
# below and never reaches `churn`). The thing that actually needs to trigger
# this guard is a NEW COMPLETE year appearing — i.e. some year after 2025
# with a full 12-month series for at least one industry_code — since that's
# the point at which the filter below (and the stimulus copy's "last year"
# claim) should move forward.
newer_complete_years <- churn_raw %>%
  filter(period != "M13", !is.na(layoff_rate), year > 2025) %>%
  group_by(year, industry_code) %>%
  summarise(n_months = n_distinct(period), .groups = "drop") %>%
  filter(n_months == 12)
stopifnot("a year after 2025 now has a complete 12-month series for at least one industry_code — update the year filter below AND the stimulus copy's \"last year\" claim together, then advance/remove this guard" =
            nrow(newer_complete_years) == 0)

# C2: jolts_industry_text carries the *actual* JOLTS industry_text associated
# with each industry_code, straight from the source data — kept alongside
# churn_pct so it can be checked against industry_xwalk.csv's own
# `jolts_series` column below (see "Crosswalk-vs-JOLTS series assertion").
# first(industry_text) is safe here: verified directly that every
# industry_code in this file maps to exactly one distinct industry_text
# (checked across the whole file, not just the 2025 subset).
churn <- churn_raw %>%
  filter(year == 2025, period != "M13", !is.na(layoff_rate)) %>%
  mutate(industry_code = as.character(industry_code)) %>%
  group_by(industry_code) %>%
  filter(n_distinct(period) == 12) %>%
  summarise(churn_pct = annual_churn(layoff_rate),
            jolts_industry_text = first(industry_text),
            .groups = "drop")

# ---- Projections ------------------------------------------------------------
# bls_naics_projection.csv's `2022 NAICS` column also holds composite groupings
# ("31, 32, 33", "44, 45", "48, 492, 493") — the same as the crosswalk. Taking
# only the first code on BOTH sides (as an earlier version of this script did)
# happens to work today because the crosswalk and the projection file both
# happen to list the same code first in each composite group — but that's a
# coincidence of the current data, not a guarantee. If either side ever lists
# a non-leading code first (e.g. the crosswalk tags Retail trade with "45"
# instead of "44, 45"), first-code-only silently reintroduces the exact
# NA-on-join bug this comment used to warn about. Unnest ALL constituent codes
# on both sides instead, so the join matches on any shared code regardless of
# order. `Employment, 2024` is carried through here too — it's this table's
# only source of industry-level employment weights, used below for the
# employment-weighted frame distribution (spec section 9).
ind_proj_wide <- read_csv(file.path(SHOCK, "bls_naics_projection.csv"), show_col_types = FALSE) %>%
  select(naics2022 = `2022 NAICS`,
         ind_proj  = `Employment change, percent, 2024–34`,
         ind_emp24 = `Employment, 2024`)

ind_proj_long <- ind_proj_wide %>%
  separate_rows(naics2022, sep = ",\\s*") %>%
  rename(naics_code = naics2022)

# One row per (crosswalk industry, constituent NAICS code); NA naics2022
# (Government, Other) survives separate_rows as a single NA-code row, which
# then correctly fails to match anything on the projection side (that side
# never has an NA code), rather than being silently dropped.
ind_key_raw <- ind_xw %>%
  select(choice_value, naics2022) %>%
  separate_rows(naics2022, sep = ",\\s*") %>%
  rename(naics_code = naics2022) %>%
  left_join(ind_proj_long, by = "naics_code")

# I1: a composite crosswalk row (e.g. Retail = NAICS 44+45) silently took the
# first constituent's ind_proj and discarded any disagreement between
# constituents — e.g. splitting Retail into 44 (-0.2%) and 45 (-9.9%) in the
# projection file would render "decline by about 0.2%" without any warning
# that 45's -9.9% was thrown away. Require all non-NA constituents of a given
# crosswalk row to agree before collapsing to one value.
#
# The same agreement-then-take-one treatment applies to ind_emp24, and NOT
# sum() — this is not the same situation as "each constituent has its own
# distinct value and we need all of it." bls_naics_projection.csv stores a
# composite group (e.g. "31, 32, 33") as ONE row already holding the
# sector's combined 2024 employment total (Manufacturing: 12,817.2K). When
# separate_rows() explodes that row into one row per constituent NAICS code,
# it REPLICATES the already-combined total onto each constituent row — it
# does not divide it. So summing across constituents multiplies the true
# total by the number of constituent codes (3x for Manufacturing and
# Transportation, 2x for Retail) — verified directly against
# bls_naics_projection.csv: Manufacturing's true total is 12,817.2, not the
# 38,452 that summing three replicated copies produces. Because the
# replicated copies are identical by construction (same source row), take-one
# is exactly correct here, the same way it already is for ind_proj. A
# disagreement in ind_emp24 across constituents is impossible under the
# current data (it would mean bls_naics_projection.csv split a composite
# across multiple rows with different totals, which it doesn't do today),
# but is checked defensively anyway so a future format change that DID split
# it that way would fail loudly rather than silently pick one arbitrary total.
ind_key_agreement <- ind_key_raw %>%
  group_by(choice_value) %>%
  summarise(n_distinct_proj = n_distinct(na.omit(ind_proj)),
            n_distinct_emp  = n_distinct(na.omit(ind_emp24)),
            .groups = "drop")
stopifnot("composite NAICS constituents disagree on ind_proj for at least one crosswalk row" =
            all(ind_key_agreement$n_distinct_proj <= 1))
stopifnot("composite NAICS constituents disagree on ind_emp24 for at least one crosswalk row" =
            all(ind_key_agreement$n_distinct_emp <= 1))

ind_key <- ind_key_raw %>%
  group_by(choice_value) %>%
  summarise(ind_proj  = if (all(is.na(ind_proj)))  NA_real_ else ind_proj[!is.na(ind_proj)][1],
            ind_emp24 = if (all(is.na(ind_emp24))) NA_real_ else ind_emp24[!is.na(ind_emp24)][1],
            .groups = "drop")

occ_proj <- read_csv(file.path(SHOCK, "bls_occ_projection.csv"), show_col_types = FALSE) %>%
  filter(occ_code != "00-0000") %>%
  select(occ_code, occ_proj = employment_change_pct_2434, occ_emp24 = employment_24)

# ---- Attach to crosswalks ---------------------------------------------------
ind <- ind_xw %>%
  mutate(industry_code = as.character(industry_code)) %>%
  left_join(ind_key, by = "choice_value") %>%
  left_join(churn,   by = "industry_code")

occ <- occ_xw %>% left_join(occ_proj, by = "occ_code")

stopifnot("industry rows changed after join"   = nrow(ind) == 21,
          "occupation rows changed after join" = nrow(occ) == 23)

# ---- Join-coverage assertions (spec section 9: "fail loudly") ---------------
# A left_join that matches nothing produces NA silently — ordinary row-count
# checks (nrow(ind) == 21, above) cannot detect this, because a broken join
# still returns one row per input row, just with NA payload columns. These
# assertions instead check that every row which HAD a joinable key actually
# GOT a value, and that the total count of successful matches hasn't drifted.
# Verified against the raw data directly (not assumed): 21 industries minus
# {Government, Other} = 19 have a non-blank naics2022 and all 19 resolve via
# bls_naics_projection.csv; 21 industries minus {Agriculture, Other} = 19 have
# a non-blank industry_code and all 19 resolve via jt_layoff_clean.csv; 23
# occupations minus {Other} = 22 have a non-blank occ_code and all 22 resolve
# via bls_occ_projection.csv.
stopifnot(
  "industry projection lost on join" =
    !any(!is.na(ind$naics2022) & is.na(ind$ind_proj)),
  "industry churn lost on join" =
    !any(!is.na(ind$industry_code) & is.na(ind$churn_pct)),
  "occupation projection lost on join" =
    !any(!is.na(occ$occ_code) & is.na(occ$occ_proj)),
  "industry projection coverage changed" = sum(!is.na(ind$ind_proj))  == 19,
  "industry churn coverage changed"      = sum(!is.na(ind$churn_pct)) == 19,
  "occupation projection coverage changed" = sum(!is.na(occ$occ_proj)) == 22
)

# ---- Crosswalk-vs-JOLTS series assertion (C2) --------------------------------
# A wrong `industry_code` in industry_xwalk.csv (e.g. swapped between two
# industries) is invisible to every assertion above: the join still succeeds
# (it just succeeds against the WRONG JOLTS series), coverage counts don't
# move, and the crosswalk's prose *labels* are still correct — only the
# NUMBER attached to them is wrong. `industry_xwalk.csv`'s `jolts_series`
# column records, for each row, the JOLTS `industry_text` its `industry_code`
# is supposed to resolve to; `churn`'s `jolts_industry_text` (above) is what
# it actually resolved to. Requiring these to match catches both a hand-edit
# swap and a BLS renumbering, and — because `jolts_series` lives in the file
# people actually hand-edit — makes a scope mismatch visible at the point of
# editing, not just at build time.
# (`ind` already carries `jolts_series` — it came straight through from
# `ind_xw`, which is where `ind` starts, and neither `ind_key` nor `churn`
# defines a column of that name to collide with it.)
stopifnot(
  "industry_xwalk.csv's jolts_series does not match the JOLTS industry_text actually resolved via industry_code — check for a wrong/swapped industry_code" =
    all(is.na(ind$jolts_series) |
        ind$jolts_series == ind$jolts_industry_text)
)

# ---- Resolve one cell -------------------------------------------------------
resolve_cell <- function(i, o) {
  has_churn   <- !is.na(i$churn_pct)
  ip <- if (is.na(i$ind_proj)) NA_real_ else i$ind_proj
  op <- if (is.na(o$occ_proj)) NA_real_ else o$occ_proj

  # Decline intensifier: the more negative of industry / occupation, if negative.
  dec_unit <- ""; dec_pct <- ""
  neg <- c(ind = ip, occ = op)
  neg <- neg[!is.na(neg) & neg < 0]
  if (length(neg) > 0) {
    which_neg <- names(neg)[which.min(neg)]
    dec_pct   <- format(round(abs(min(neg)), 1), nsmall = 1)
    dec_unit  <- if (which_neg == "ind") i$churn_unit else o$decline_unit
    if (is.na(dec_unit) || dec_unit == "") { dec_unit <- ""; dec_pct <- "" }
  }
  has_decline <- dec_unit != ""

  frame <- if (has_churn && has_decline) "churn_decline"
           else if (has_churn)           "churn"
           else if (has_decline)         "decline"
           else                          "generic"

  churn_unit <- ""; churn_pct <- ""; churn_clause <- ""
  if (has_churn) {
    churn_unit <- i$churn_unit
    # The "roughly one in N" clause is derived from the ROUNDED, DISPLAYED
    # churn_pct (not the raw unrounded rate), so the two numbers in the same
    # sentence are always arithmetically consistent with each other — e.g.
    # "about 8% ... roughly one in twelve", never "... roughly one in
    # thirteen" (which is what the raw 7.99% would give, but that precision
    # never appears in the sentence the respondent reads). Both roundings are
    # equally "true" given the hedge words "about"/"roughly"; consistency of
    # what's on screen wins the tiebreak. See task-4-report.md for the ruling.
    churn_pct_displayed <- round(i$churn_pct)
    churn_pct <- as.character(churn_pct_displayed)
    n_word <- if (churn_pct_displayed == 0) NA_character_
              else churn_word(round(100 / churn_pct_displayed))
    churn_clause <- if (is.na(n_word)) "" else paste0(" — roughly one in ", n_word)
  }

  list(frame = frame,
       churn_unit = churn_unit, churn_pct = churn_pct, churn_clause = churn_clause,
       decline_unit = dec_unit, decline_pct = dec_pct,
       ind_code = as.character(i$choice_value), occ_code = as.character(o$choice_value))
}

# ---- Build all 21 x 23 cells ------------------------------------------------
lookup <- list()
for (iv in 1:21) {
  i <- ind[ind$choice_value == iv, ]
  cell <- list()
  for (ov in 1:23) {
    o <- occ[occ$choice_value == ov, ]
    cell[[as.character(ov)]] <- resolve_cell(i, o)
  }
  lookup[[as.character(iv)]] <- cell
}

# ---- Assertions (spec section 9) --------------------------------------------
flat <- do.call(rbind, lapply(names(lookup), function(iv)
  do.call(rbind, lapply(names(lookup[[iv]]), function(ov) {
    c <- lookup[[iv]][[ov]]
    tibble(ind = as.integer(iv), occ = as.integer(ov), frame = c$frame,
           churn_unit = c$churn_unit, churn_pct = c$churn_pct, churn_clause = c$churn_clause,
           decline_unit = c$decline_unit, decline_pct = c$decline_pct)
  }))))

stopifnot("must be 483 cells" = nrow(flat) == 483)
stopifnot("unknown frame" = all(flat$frame %in% c("churn_decline","churn","decline","generic")))
stopifnot("churn frame missing its number" =
            all(flat$churn_pct[grepl("churn", flat$frame)] != ""))
stopifnot("decline frame missing its number" =
            all(flat$decline_pct[grepl("decline", flat$frame)] != ""))
stopifnot("generic must carry no numbers" =
            all(flat$churn_pct[flat$frame == "generic"] == "" &
                flat$decline_pct[flat$frame == "generic"] == ""))
stopifnot("one-in-N must be suppressed above 20" =
            all(flat$churn_clause[flat$churn_pct != "" &
                as.numeric(flat$churn_pct) < 5] == ""))

# Spec section 9: "every non-generic cell has a non-missing, correctly-signed
# number." churn_pct and decline_pct are both stored as unsigned magnitudes
# (decline_pct via abs() in resolve_cell() above; churn_pct is a rate, never
# negative by construction) — the prose ("declined by about X%", "roughly one
# in N") supplies the direction/sign in words. A negative or zero string here
# would mean either the abs() was lost (an unsigned "-3.9%" reaching a
# respondent) or a churn rate of exactly zero routed into the churn frame,
# neither of which should ever happen.
stopifnot("churn_pct must be strictly positive where present" =
            all(as.numeric(flat$churn_pct[flat$churn_pct != ""]) > 0))
stopifnot("decline_pct must be strictly positive where present" =
            all(as.numeric(flat$decline_pct[flat$decline_pct != ""]) > 0))

# ---- C3: churn_pct ceiling and one-in-N floor --------------------------------
# The only prior guard on churn_pct was "> 0" — no upper bound. A 5x input
# mis-scale (a plausible units or vintage change upstream) produces a
# churn_pct near 92 with no assertion to catch it, and the rendered sentence
# reads "...about 92% of all jobs — roughly one in one." Ceiling chosen as
# ~45: the current observed max across all industry codes in use is 37%
# (Arts, entertainment, and recreation), so 45 gives headroom for normal
# data movement while still catching an order-of-magnitude-style error.
stopifnot("churn_pct exceeds sane ceiling (45%; current observed max is ~37%) — check for an input-rate scaling/units/vintage error upstream" =
            all(as.numeric(flat$churn_pct[flat$churn_pct != ""]) <= 45))

# Lower bound on the one-in-N denominator: churn_pct >= 50 would round to
# "one in one", which is a claim of certainty, not a hedge — checked directly
# against churn_pct (not just against churn_clause) so this fires even though
# churn_word() now separately suppresses n == 1 into an empty clause; the
# suppression alone would hide the bad rate rather than flag it.
stopifnot("one-in-N denominator must be at least 2 (churn_pct at or above ~50 would imply 'one in one')" =
            all(round(100 / as.numeric(flat$churn_pct[flat$churn_pct != ""])) >= 2))

# ---- Label-alignment assertions (row-misalignment, not a broken join) -------
# A row-shifted prose label (e.g. `churn_unit` off by one row) produces a
# cell with every number correct and a frame correctly routed, but a
# respondent reads a sentence naming the WRONG industry — e.g. a healthcare
# respondent reading "In the arts, entertainment, and recreation industry...
# about 8%...". The join-coverage assertions above cannot see this: nothing
# is missing, a value just landed on the wrong row. Re-derive each cell's
# expected label straight from the crosswalk, keyed on that cell's own
# ind_code/occ_code (NOT from the `ind`/`occ` objects the main loop used, so
# a shift introduced anywhere in that pipeline is still visible here), and
# require an exact match.
ind_churn_unit_by_code   <- setNames(ind_xw$churn_unit,   as.character(ind_xw$choice_value))
occ_decline_unit_by_code <- setNames(occ_xw$decline_unit, as.character(occ_xw$choice_value))

stopifnot("churn_unit is not this cell's own industry label" =
  all(flat$churn_unit == "" |
      flat$churn_unit == ind_churn_unit_by_code[as.character(flat$ind)]))
# decline_unit names either the cell's own industry (churn_unit vocabulary)
# or its own occupation (decline_unit vocabulary) — never any other row's
# label from either vocabulary. The two vocabularies don't overlap in text
# ("the retail trade industry" vs. "office, administrative, and clerical
# jobs"), so this still catches a same-vocabulary off-by-one shift.
stopifnot("decline_unit is not this cell's own industry or occupation label" =
  all(flat$decline_unit == "" |
      flat$decline_unit == ind_churn_unit_by_code[as.character(flat$ind)] |
      flat$decline_unit == occ_decline_unit_by_code[as.character(flat$occ)]))

# ---- Churn-clause / churn_pct consistency ------------------------------------
# Spec's rounding-convention ruling (task-4-report.md addendum) requires the
# "roughly one in N" word to be derivable from the DISPLAYED churn_pct in
# that same cell — that is the whole reason the ruling rounds churn_pct
# first and derives N from the rounded value, so the two numbers in one
# sentence never contradict each other. The existing "suppress above 20"
# check only catches decoupling by accident, when it happens to cross that
# one boundary; this closes the loop directly by recomputing the expected
# word from what's actually printed and requiring an exact match.
extract_one_in_word <- function(clause) stringr::str_match(clause, "roughly one in (\\w+)$")[, 2]
clause_rows    <- which(flat$churn_clause != "")
expected_word  <- vapply(clause_rows, function(k)
                    churn_word(round(100 / as.numeric(flat$churn_pct[k]))), character(1))
actual_word    <- vapply(clause_rows, function(k)
                    extract_one_in_word(flat$churn_clause[k]), character(1))
stopifnot("churn_clause one-in-N decoupled from displayed churn_pct" =
            identical(expected_word, actual_word))

# ---- Employment-weighted frame distribution (spec section 9) ----------------
# The unweighted 483-cell count treats "Manufacturing x Manager" and
# "Healthcare x Nurse" as equally likely, which they are not — the PAP needs
# the distribution respondents will actually produce, weighted by how many
# people work in each cell. We don't have a joint industry-by-occupation
# national employment table (BLS publishes industry and occupation
# projections separately, which is exactly why this script joins two
# separate files rather than one). Absent joint data, we proxy the weight of
# cell (industry, occupation) as the PRODUCT of each dimension's national
# employment share, i.e. treat self-reported industry and occupation as
# independent draws from their national marginals. This is the only
# defensible choice given what's in `ind_emp24` / `occ_emp24`: an
# industry-only weighting would ignore that decline routing (and hence the
# churn vs. churn_decline split) depends on the paired occupation's size too;
# an occupation-only weighting would ignore that churn itself is industry-only.
# The product is the standard independence-assumption proxy for a joint
# distribution when only marginals are available.
#
# Coverage gap, stated explicitly rather than silently zero-filled: Government
# and "Other" (write-in) industries, and "Other" (write-in) occupation, have
# no national employment figure in these BLS tables (bls_naics_projection.csv
# excludes public administration; free-text write-ins have no NAICS/SOC code
# to look up by definition) — so `ind_emp24`/`occ_emp24` is NA for those rows,
# and any cell touching them drops out of the weighted total (na.rm) rather
# than being counted as zero-population. The printed coverage line reports
# exactly how much of the unweighted cell count that excludes.
weights <- flat %>%
  left_join(ind %>% transmute(ind = choice_value, ind_emp24), by = "ind") %>%
  left_join(occ %>% transmute(occ = choice_value, occ_emp24), by = "occ") %>%
  mutate(cell_weight = ind_emp24 * occ_emp24)

n_weighted <- sum(!is.na(weights$cell_weight))
total_weight <- sum(weights$cell_weight, na.rm = TRUE)

# ---- Report -----------------------------------------------------------------
cat("\nFrame distribution across", nrow(flat), "cells (unweighted):\n")
print(flat %>% count(frame) %>% mutate(pct = round(100 * n / sum(n), 1)))

cat("\nFrame distribution weighted by national employment",
    "(industry share x occupation share; independence-assumption proxy",
    "for the unobserved joint distribution):\n")
cat(n_weighted, "of", nrow(flat), "cells (", round(100 * n_weighted / nrow(flat), 1),
    "% ) have a known employment weight; the rest touch Government, or a",
    "write-in \"Other\" industry/occupation, none of which have a BLS national",
    "employment figure, and are excluded from the weighted total below",
    "(na.rm, NOT treated as zero population).\n")
cat("These shares are CONDITIONAL on the", n_weighted, "weighted cells above —",
    "NOT unconditional full-sample shares. Government and write-in \"Other\"",
    "are real categories respondents will select, and the excluded cells are",
    "not a random slice of the 483 (see composition below), so do not read",
    "the percentages here as \"the\" expected cell sizes without accounting",
    "for that excluded mass.\n")
print(weights %>% filter(!is.na(cell_weight)) %>%
        group_by(frame) %>%
        summarise(weight = sum(cell_weight), .groups = "drop") %>%
        mutate(pct = round(100 * weight / total_weight, 1)) %>%
        select(frame, pct))

n_excluded <- sum(is.na(weights$cell_weight))
cat("\nUnweighted frame composition of the", n_excluded,
    "excluded cells (Government and/or write-in \"Other\" on either side),",
    "shown so the direction of the skew is visible rather than inferred:\n")
print(weights %>% filter(is.na(cell_weight)) %>%
        count(frame) %>% mutate(pct = round(100 * n / sum(n), 1)))

cat("\nBy industry:\n")
print(flat %>% group_by(ind) %>%
        summarise(frames = paste(sort(unique(frame)), collapse = "/"),
                  churn = first(churn_pct), .groups = "drop") %>%
        left_join(ind_xw %>% select(ind = choice_value, industry_survey), by = "ind") %>%
        mutate(industry = str_trunc(industry_survey, 40)) %>%
        select(ind, industry, churn, frames), n = 21)

write_json(lookup, file.path(OUT, "exp2_lookup.json"), auto_unbox = TRUE, pretty = TRUE)
cat("\nwrote", file.path(OUT, "exp2_lookup.json"), "\n")
