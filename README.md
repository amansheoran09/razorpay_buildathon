# Settled

Settled reconciles a merchant's books across ledger, gateway and bank, clears
what it can prove, and gives finance an honest queue of what it can't.

**Razorpay Buildathlon · Track 04 · AI Finance Controller**

---

## The numbers

Both datasets, seed 42, rules-only mode. Recomputed from the committed run
artifacts in `runs/` — nothing here is typed by hand.

| Dataset  | Records | Groups | Auto-cleared | Precision | Recall | False-match rate | Escalation precision | Throughput | Calibration error |
|----------|--------:|-------:|-------------:|----------:|-------:|-----------------:|---------------------:|-----------:|------------------:|
| standard |   1,804 |    512 |        73.8% |     0.976 |  0.976 |        **0.00%** |                1.000 | 11,900 rec/s |           0.085 |
| hard     |   2,227 |    590 |        38.3% |     0.809 |  0.804 |            0.44% |                0.868 |  7,500 rec/s |           0.061 |

Both calibration errors are under the 0.10 bar the spec sets. Escalation
precision on the hard dataset is 0.868, not 1.0 — 13% of the items sent to a
human there were the system giving up on work it should have done, and the
metric is built so it can say that.

The hard dataset is 30% clean data, bundles of up to eight invoices, and 40% of
bank narrations corrupted. Its numbers are worse and they are published as-is.
See the honesty report for every match that was wrong.

**Cost per record is ₹0.00 in every committed run** because stage 4 has not been
run against the live API — see *What is not finished* below. The stage-4 path
itself is exercised end to end in `tests/stage4-pipeline.test.ts` against a
scripted transport, so the prompt, the four-check gate, the cache and the
apply step are all proven; only the model's own answers are unexercised.

---

## Run it in three commands

```bash
npm install
npm run generate -- --all --seed 42 --count 500
npm run demo
```

`npm run demo` generates both datasets, reconciles both, runs the ablation, and
starts the interface at http://localhost:3000.

To run one piece at a time:

```bash
npm run generate -- --dataset standard --seed 42 --count 500
npm run reconcile -- --dataset standard --mode rules_only
npm run evaluate -- --run RUN-STAN-RULES-42
npm run ablate -- --dataset standard --seed 42
npm test
```

---

## How it works

Five stages. The first three are deterministic, the fourth is the model, and the
fifth scores the result against ground truth.

1. **Exact** — gateway receipt equals the invoice number, the bank line carries
   the settlement reference, amounts agree exactly after fees, dates are ordered
   and inside the window. Confidence 1.0. Zero false positives, asserted in tests.
2. **Tolerant** — relax one dimension at a time from a base of 0.98 and subtract a
   fixed penalty per relaxation. Anything landing below the auto-clear threshold
   is left open rather than committed.
3. **Combinatorial** — merged payments (many payments, one credit) and split
   payments (one invoice, many credits). A settlement is treated as atomic. Where
   more than one subset reconciles, the engine emits every candidate and refuses
   to choose.
4. **Adjudication** — the model picks from a numbered candidate list that
   deterministic code built.
5. **Scoring** — precision, recall, per-category recall, calibration and the
   false-match rate, all against the generator's own ground truth.

### The no-hallucinated-money guarantee

The model never sees a blank page. It receives candidate groups that
deterministic code produced and returns exactly one shape: a decision, a
candidate id, an exception type, a confidence, a rationale and a list of evidence
ids. There is no field in which an amount, an account or a new record id can be
returned, and the schema is closed — a response carrying an invented
`amount_paise` is rejected, not silently stripped.

Four checks run in order on every response: schema, candidate membership,
evidence membership, and consistency. A failure is a normal counted outcome that
routes the item to a human, and the count is displayed on the scorecard rather
than hidden. Twelve adversarial responses are asserted to be rejected in
`tests/adjudicator-contract.test.ts`.

---

## The exception taxonomy

Thirteen types. The generator produces these, the engine classifies into these,
the queue filters by these, and the metrics report per-category recall on these.

| Type | Label | Severity | Blocks auto-clear |
|---|---|---|---|
| `AMOUNT_MISMATCH` | Amount mismatch | review | yes |
| `TIMING_LAG` | Timing lag | informational | no |
| `SPLIT_PAYMENT` | Split payment | review | yes |
| `MERGED_PAYMENT` | Merged payment | review | yes |
| `FEE_DISCREPANCY` | Fee discrepancy | review | yes |
| `REFUND_OFFSET` | Refund offset | review | yes |
| `CHARGEBACK_DEBIT` | Chargeback debit | blocking | yes |
| `DUPLICATE_RECORD` | Duplicate record | blocking | yes |
| `MISSING_IN_BANK` | Missing in bank | blocking | yes |
| `MISSING_IN_GATEWAY` | Missing in gateway | review | yes |
| `MISSING_IN_LEDGER` | Missing in ledger | review | yes |
| `NARRATION_UNPARSEABLE` | Narration unreadable | review | yes |
| `UNMATCHED_RESIDUAL` | Unmatched | review | yes |

Per-category recall on the standard dataset: every category at 100% except
`NARRATION_UNPARSEABLE` at 36.8%, which is the gap stage 4 exists to close.

---

## What it gets wrong

The honesty report at `/runs/{runId}/honesty` lists every false positive in full,
largest amount first, with the proposed group, the true group, and an explanation
of what fooled it. The top three failure modes:

**Destroyed bank references.** When a narration is truncated mid-reference or the
reference is replaced by a bank-internal sequence number, only amount and date
remain. On the standard dataset this accounts for all twelve wrong matches. The
system does not guess — it escalates — but it also cannot resolve them.

**Split payments on the hard dataset.** When several instalments and several
unrelated credits sit in the same window with corrupted references, the
subset-sum finds a set that sums correctly and is not the right set. Recall drops
to 59.5%. These are visible in the honesty report as "wrongly included".

**Late settlements outside the window.** A credit landing well past the date
window is left as a two-way match with a missing bank leg. Correct as a
description, wrong as a group.

---

## At larger volumes

Measured, not extrapolated. Same engine, same seed, rules-only, on one laptop.

| Invoices | Records | Wall clock | Throughput | Precision |
|---------:|--------:|-----------:|-----------:|----------:|
|      500 |   1,810 |     173 ms | 10,500/s |     0.966 |
|    5,000 |  18,128 |    3.2 s   |  5,700/s |     0.976 |
|   10,000 |  36,103 |   12.1 s   |  3,000/s |     0.972 |
|   20,000 |  72,450 |   48.1 s   |  1,500/s |     0.971 |

Accuracy is flat across the range; only speed degrades. Stages 1 and 2 are
hash-joins on an amount index and stay near-linear (stage 1 is 147ms of the 12
seconds at 36,000 records). The remaining curve is in stage 3 and the attachment
pass, where the work per credit still grows with the size of the period.

Getting here meant replacing four nested scans with indexes. The run output
hashes did not change, which is how we know only the speed moved — they are
pinned in `tests/golden.test.ts` for exactly that reason.

---

## Limitations

- Synthetic data only. Real narrations are messier in ways not modelled here.
- Single currency. No FX, no conversion date, no revaluation.
- No carry-forward across periods.
- Subset-sum capped at 8 members (standard) and 12 (hard).
- No netting across multiple settlement accounts.
- A settlement is assumed atomic. A gateway splitting one batch across two
  payouts would defeat stage 3.
- Human decisions are recorded but do not feed back into matching.

---

## What is not finished

**Stage 4 has never run against the real API.** No `ANTHROPIC_API_KEY` was
available during the build, so `hybrid` and `llm_only` have not executed end to
end. The adjudicator, validation gate, prompt builder and response cache are all
written, and the gate is covered by the twelve adversarial contract tests, but
the ablation table has one row instead of three and every committed artifact is
`rules_only`.

To finish it: put a key in `.env.local` and run

```bash
npm run ablate -- --dataset standard --seed 42
```

The ablation panel on the scorecard says this in the interface too, rather than
leaving a judge to work out why the table is short.

---

## Reproducing our numbers

```bash
npm run generate -- --all --seed 42 --count 500
npm run reconcile -- --dataset standard --mode rules_only
npm run reconcile -- --dataset hard --mode rules_only
npm run evaluate -- --run RUN-STAN-RULES-42
```

Two runs over the same seed produce identical output hashes; `tests/determinism.test.ts`
asserts it. The hash is shown on the scorecard footer and in the runs table.

---

## Architecture

```
src/lib/          money (integer paise), seeded rng, ids, stable hashing, config, sqlite
src/domain/       types, the 13-type exception taxonomy, the closed LLM output schema
src/generator/    synthetic month of trade + ground truth, written as it is created
src/ingest/       messy CSV in, typed records out; reference extraction from narration
src/engine/       stages 1-3, candidate generation, dedupe, attachment, residual
src/adjudicator/  stage 4: prompt, four-check gate, prompt-hash cache
src/eval/         metrics, calibration, artifacts, queue view model, terminal report
src/app/          six screens and the API routes
scripts/          generate, reconcile, evaluate, ablate, demo
tests/            79 tests: money, generator, engine, contract, determinism, metrics
```

`src/engine/` never imports `src/generator/` except for shared fee-band constants.
A test asserts it. That firewall is what makes the accuracy numbers meaningful.
