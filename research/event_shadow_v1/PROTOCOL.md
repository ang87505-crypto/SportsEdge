# Event shadow contract v1 — engineering specification, not strategy registration

The prototype accepts a body, an independently captured HTTPS receipt, and
reviewed bitemporal issuer/security mappings. It makes no network requests and
cannot itself authenticate a fabricated receipt. Production ingestion must be
server-owned, validate TLS and final redirect destination, restrict egress,
limit response size, use timeouts/backoff, and create an immutable receipt at
actual observation. Never accept these evidence fields from a public client.
Persist receipt, permitted content snapshot and mapping evidence before output.
Dedup state here is an in-memory caller set; durable atomic uniqueness and a
correction/retraction index are required for a concurrent or restarted service.

The schema in `pipeline.py` binds source URL, content, publication/observation/
revision times, permanent security ID, ticker, mapping evidence, decision time,
input/output hashes, model identity and latency. Classification is supplied
metadata and expressly unvalidated. Novelty, surprise, materiality, probability,
sector relationships and horizon remain unknown. Text is inert; no LLM tools
or instructions from source documents are executed. Multiple share-class
mappings, deleted events, missing identity and late observations are quarantined.
Fed/macroeconomic sector-wide mapping is not implemented; unmatched macro events
are quarantined too. A trusted source can still contain incorrect claims.

Proposed service: approved HTTPS/RSS collector -> immutable receipt/version
store -> exact dedup -> reviewed issuer/security map -> simple event classifier
-> human labels -> optional calibrated model -> shadow review log. No broker
integration. Add social/IR/FDA sources only after per-source terms, identity and
rate-limit review. SEC: identifiable user agent and aggregate <=10 requests/s;
start substantially below that, respect 429 and Retry-After. No collector active.

Track B is NOT registered by this document: no parameters or promotion decision
are approved. Track A remains untouched. Before Track C outcome collection,
freeze prospective start/end, model version and training-data cutoff, source
allowlist, event categories, adjudication rules, dedup/revision rules, latency,
universe, statistical unit and benchmarks. Proposed first study: SEC earnings/
guidance events over subsequent sessions, versus a no-event predictor, simple
category/dictionary baseline and a regularized model. Test LLM last. Include
all attempts in a research registry; future untouched holdout, never reuse the
frozen 2012–2025 windows casually. LLM training on later events can contaminate
historical news tests even if supplied prompts contain only earlier text.

Pre-register horizons and label construction before looking at returns. Measure
Brier score/log loss and reliability, precision/recall at frozen thresholds,
false-positive cost, abstention, publication-to-observation and execution age,
turnover and net economic effect with/without each feature. Group uncertainty
by calendar blocks and correlated event clusters. Apply multiple-testing control
across actual research attempts. Missing licensed quotes/expectations or timely
history prevents an after-cost tradability claim. Do not manufacture consensus
surprises from realized subsequent outcomes. No numerical predictive performance
has been measured; no prospective collector has started.
