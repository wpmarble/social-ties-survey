source("~/Dropbox/interal-migration/survey/public-survey-files/exp2/build/exp2_churn.R")

# 12 months at exactly 1% compounds to 1 - 0.99^12 = 11.36%, NOT 12%.
# This is the whole point: monthly * 12 would give 12.0 and be wrong.
got <- annual_churn(rep(1, 12))
stopifnot("compounding is wrong" = abs(got - 11.3615) < 0.001)
stopifnot("must not be monthly*12" = abs(got - 12) > 0.5)

# Zero months means zero risk.
stopifnot(abs(annual_churn(rep(0, 12))) < 1e-9)

# Must reject anything that is not a complete 12-month series.
stopifnot("must reject short series" = inherits(try(annual_churn(rep(1, 11)), silent = TRUE), "try-error"))
stopifnot("must reject NA"           = inherits(try(annual_churn(c(NA, rep(1, 11))), silent = TRUE), "try-error"))

# Number words, and the >20 suppression boundary.
stopifnot(churn_word(8)  == "eight")
stopifnot(churn_word(12) == "twelve")
stopifnot(churn_word(20) == "twenty")
stopifnot(is.na(churn_word(21)))   # suppressed above 20

cat("churn tests passed\n")
