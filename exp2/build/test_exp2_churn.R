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

# Non-uniform test vectors: these are essential to detect implementations that
# reduce the 12 rates to a single representative value (e.g., max, mean, min)
# and then compound that one value 12 times. Such implementations are wrong but
# pass all uniform-vector tests because "compound the max alone" and "compound
# all twelve" are mathematically identical when all input values are equal.
# The following vectors have deliberately high variance so that max-reduction
# diverges sharply from correct compounding.

# High-variance case: 10% and eleven 0.1% rates.
# Correct compounding: (1 - 0.90 * 0.999^11) * 100 ≈ 10.98506%
# Max-compounded (wrong): (1 - 0.9^12) * 100 ≈ 71.75705%
got_high_var <- annual_churn(c(10, rep(0.1, 11)))
stopifnot("high-variance compounding is wrong" = abs(got_high_var - 10.98506) < 0.001)
stopifnot("must not max-compound" = abs(got_high_var - 71.75705) > 0.5)

# Realistic non-uniform case: actual retail trade 2025 rates.
# Correct compounding: 12.07706%
# Max-compounded (wrong): 17.59735%
retail_2025_rates <- c(1.2, 1.6, 1.1, 1.0, 1.0, 1.0, 1.1, 1.0, 1.0, 1.1, 0.9, 0.8)
got_retail <- annual_churn(retail_2025_rates)
stopifnot("retail 2025 compounding is wrong" = abs(got_retail - 12.07706) < 0.001)

cat("churn tests passed\n")
