# Annual probability that a given job ends in layoff/discharge, compounded from
# the 12 monthly JOLTS rates. NEVER monthly * 12 — see spec section 4.
annual_churn <- function(monthly_rates) {
  if (length(monthly_rates) != 12) stop("need exactly 12 monthly rates, got ", length(monthly_rates))
  if (any(is.na(monthly_rates)))   stop("monthly rates contain NA")
  (1 - prod(1 - monthly_rates / 100)) * 100
}

# Spell the "roughly one in N" denominator. Returns NA above 20 (signal to
# suppress the clause entirely, spec section 4), and also for n == 1: "roughly
# one in one" is not a hedge, it's a claim of certainty ("about 92% ... roughly
# one in one"), and can only arise from a churn_pct >= ~50, which itself signals
# an upstream units/scaling error (see the C3 ceiling assertion in
# build_exp2_lookup.R). Suppressing here is defense-in-depth for that same bug.
churn_word <- function(n) {
  words <- c("one", "two", "three", "four", "five", "six", "seven", "eight",
             "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
             "sixteen", "seventeen", "eighteen", "nineteen", "twenty")
  if (is.na(n) || n < 1 || n > 20) return(NA_character_)
  if (n == 1) return(NA_character_)
  words[n]
}
