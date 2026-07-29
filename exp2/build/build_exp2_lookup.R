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
churn <- read_csv(file.path(SHOCK, "jt_layoff_clean.csv"), show_col_types = FALSE) %>%
  filter(year == 2025, period != "M13", !is.na(layoff_rate)) %>%
  mutate(industry_code = as.character(industry_code)) %>%
  group_by(industry_code) %>%
  filter(n() == 12) %>%
  summarise(churn_pct = annual_churn(layoff_rate), .groups = "drop")

# ---- Projections ------------------------------------------------------------
# bls_naics_projection.csv's `2022 NAICS` column also holds composite groupings
# ("31, 32, 33", "44, 45", "48, 492, 493") — the same as the crosswalk. If we
# only split the crosswalk side (below) and leave this side as the full
# composite string, "31" never matches "31, 32, 33" and the join silently
# returns NA for Manufacturing/Retail/Transportation. Split both sides the
# same way so the join actually succeeds.
ind_proj <- read_csv(file.path(SHOCK, "bls_naics_projection.csv"), show_col_types = FALSE) %>%
  select(naics2022 = `2022 NAICS`, ind_proj = `Employment change, percent, 2024–34`) %>%
  mutate(naics2022 = str_trim(str_split_fixed(as.character(naics2022), ",", 2)[, 1]))

occ_proj <- read_csv(file.path(SHOCK, "bls_occ_projection.csv"), show_col_types = FALSE) %>%
  filter(occ_code != "00-0000") %>%
  select(occ_code, occ_proj = employment_change_pct_2434)

# ---- Attach to crosswalks ---------------------------------------------------
# naics2022 in the xwalk can be a list like "31, 32, 33"; take the first code.
ind <- ind_xw %>%
  mutate(naics_key = str_trim(str_split_fixed(as.character(naics2022), ",", 2)[, 1]),
         industry_code = as.character(industry_code)) %>%
  left_join(ind_proj, by = c("naics_key" = "naics2022")) %>%
  left_join(churn,    by = "industry_code")

occ <- occ_xw %>% left_join(occ_proj, by = "occ_code")

stopifnot("industry rows changed after join"   = nrow(ind) == 21,
          "occupation rows changed after join" = nrow(occ) == 23)

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
           churn_pct = c$churn_pct, decline_pct = c$decline_pct,
           churn_clause = c$churn_clause)
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

# ---- Report -----------------------------------------------------------------
cat("\nFrame distribution across", nrow(flat), "cells:\n")
print(flat %>% count(frame) %>% mutate(pct = round(100 * n / sum(n), 1)))
cat("\nBy industry:\n")
print(flat %>% group_by(ind) %>%
        summarise(frames = paste(sort(unique(frame)), collapse = "/"),
                  churn = first(churn_pct), .groups = "drop") %>%
        left_join(ind_xw %>% select(ind = choice_value, industry_survey), by = "ind") %>%
        mutate(industry = str_trunc(industry_survey, 40)) %>%
        select(ind, industry, churn, frames), n = 21)

write_json(lookup, file.path(OUT, "exp2_lookup.json"), auto_unbox = TRUE, pretty = TRUE)
cat("\nwrote", file.path(OUT, "exp2_lookup.json"), "\n")
