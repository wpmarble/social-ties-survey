library(tidyverse)
XW <- "~/Dropbox/interal-migration/survey/public-survey-files/exp2"

ind <- read_csv(file.path(XW, "industry_xwalk.csv"), show_col_types = FALSE)
occ <- read_csv(file.path(XW, "occupation_xwalk.csv"), show_col_types = FALSE)

stopifnot(
  "industry needs choice_value" = "choice_value" %in% names(ind),
  "occupation needs choice_value" = "choice_value" %in% names(occ),
  "industry needs churn_unit"    = "churn_unit"   %in% names(ind),
  "occupation needs decline_unit"= "decline_unit" %in% names(occ),
  "industry choice_value must be 1:21" = identical(sort(ind$choice_value), as.double(1:21)),
  "occupation choice_value must be 1:23" = identical(sort(occ$choice_value), as.double(1:23))
)

# Prose labels required for every real category; blank only for the "Other" rows.
stopifnot(
  "churn_unit missing"   = !any(is.na(ind$churn_unit[ind$choice_value <= 20])),
  "decline_unit missing" = !any(is.na(occ$decline_unit[occ$choice_value <= 22]))
)
cat("xwalk checks passed\n")
