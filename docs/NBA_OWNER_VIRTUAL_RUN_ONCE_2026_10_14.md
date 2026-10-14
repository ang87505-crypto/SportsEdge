# NBA owner-triggered simulated-bet recording
This implements one virtual NBA research position per explicit owner click.
Existing shared NBA ledger uses one-percent-of-available-cash stake.
The separate 100 x $10 NBA experiment is NOT modified.
Authentication: the existing dedicated private owner cookie; CSRF same origin
and fixed 4-field confirmation. No browser-supplied odds/stake/model accepted.
Fresh pregame full two-way sportsbook quote and frozen Elo forecast are required.
Immediately prior to POST the server recomputes the best qualifying quote;
the existing immutable Postgres research_place RPC checks eligibility and locks
the virtual account to prevent duplicates or overspending. Receipt is reread
and verified before returning confirmed status. Ambiguity is not retried.
The model EV threshold is 2% and its probability must exceed the no-vig price.
No sportsbook API, sportsbook order, money movement, odds-provider purchase or
automatic scheduling is added. With last odds dated Oct 8, zero new positions
should be created on Oct 14. Do not backdate data or fill the 100-bet cohort.
