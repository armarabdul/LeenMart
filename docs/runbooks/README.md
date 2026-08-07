# Runbooks

One runbook per alert defined in SDD §19.4. An alert without a runbook is
deleted — it will be ignored during an incident anyway.

Each runbook states: what fired, what it means, what to check first, how to
mitigate, and how to confirm recovery.

None are written yet: no business module is deployed, so no business alert
exists. The first three to write, in order, are:

1. `api-5xx-rate.md` — API error rate above 2% for 5 minutes (P1)
2. `readiness-failing.md` — `/readyz` returning 503 across tasks (P1)
3. `queue-depth.md` — BullMQ queue depth above 1,000 (P2)
