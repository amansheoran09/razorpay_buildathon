# Decisions

Every choice the build spec did not make for us, and why. Spec rule 1 says an
unspecified choice must be recorded here rather than invented silently.

---

## Stack

**Next.js 16.3.2, not 15.** `create-next-app@latest` installs 16. Nothing in the
spec depends on the difference. `serverExternalPackages: ['better-sqlite3']` is
set in `next.config.ts` so the App Router bundler does not try to trace a native
module.

**better-sqlite3 13.0.3.** Installs from a prebuilt binary on Windows with no
compiler toolchain, verified before anything was built on top of it.

**nanoid via `customRandom`, not `nanoid()`.** nanoid is not seedable by default.
The seeded PRNG is passed in as the byte source, otherwise every generated
Razorpay identifier would break determinism silently.

**`noUncheckedIndexedAccess` on.** The subset-sum and the matching stages index
arrays constantly. It caught real bugs.

**Vitest config as `.mts`.** A `.ts` Vite config in a CommonJS package triggers a
loader warning on every run.

**Scripts wrap their body in `main()`.** `tsx` transpiles to CJS, which rejects
top-level `await`.

---

## Money

**Rupee strings are parsed by splitting on the decimal point.** `parseFloat` is
never applied to a whole amount. `parseFloat('8.165') * 100` is
`816.4999999999999`, which rounds to 816 instead of 817 — the rounding decision
would be made by float noise rather than by us.

**More than two decimal places is rejected, not rounded.** A three-decimal rupee
amount in a bank export means the file is wrong. Silently rounding it hides that.

**Indian grouping via `Intl.NumberFormat('en-IN')`.** `1,00,000.00`, not
`100,000.00`. The audience is an Indian finance team.

---

## Generator

**Scenario allocation is by exact quota, not by independent weighted draws.**
Drawing 500 independent samples from a 62% category has a standard error of about
2.2 percentage points, so random sampling would breach the spec's own +/-1.5pp
acceptance criterion by chance alone. Largest-remainder rounding makes the mix
exact and still deterministic.

**A settlement batch settles on one date.** Originally each payment in a batch
took its own settlement lag, which spread a single batch across a week and made
it impossible for any date-windowed matcher to see the batch as a unit. That was
a generator bug, not an engine limitation: a real settlement batch pays out once.

**Bank record IDs are assigned after the statement is sorted.** The CSVs carry no
record IDs, exactly as a real export would not, so IDs are positional and the
ingest layer assigns them in file order. The bank statement is sorted into
posting order before IDs are assigned, and ground truth is remapped accordingly.

**Two exception types the scenario list does not name directly.** The spec has 13
exception types but 11 scenarios. `fee_variance` emits `AMOUNT_MISMATCH` when the
applied fee lands far outside the plausible band and `FEE_DISCREPANCY` when it
stays inside; `missing_in_gateway` emits `MISSING_IN_LEDGER` when there is no
invoice behind the credit at all. `UNMATCHED_RESIDUAL` is emitted by the engine,
never the generator.

**Standard applies no blanket narration corruption.** The spec assigns 40% global
corruption to the hard dataset only, and gives standard corruption "per the
scenario". Standard therefore corrupts narration inside `narration_noise` and
nowhere else, which is what produces the spec's expected stage-1 yield band.

---

## Engine

**Merged payments are matched by settlement batch, not free-form subset-sum.**
This is the most consequential decision in the build. The first implementation
ran bounded subset-sum over every open payment in the date window — roughly
thirty of them — and it found subsets that were arithmetically perfect and
factually wrong, because with enough candidates and a 100-paise tolerance
something always sums. Precision was 0.55.

A settlement is atomic: a bank credit carries all of a batch or none of it. Once
the search ran over whole settlement batches instead of individual payments,
merged-payment recall went from 0% to 100% and overall precision from 0.55 to
0.91. The bounded subset-sum solver is still there and still used for split
payments and for batches whose reference is destroyed, but it is no longer
allowed to assemble a group out of unrelated payments.

**A solution must contain at least two payments.** A one-payment "batch" is not a
merge; it is stage 1's job. Allowing it let stage 3 steal records from split
payments.

**Reference near-matching requires a true transposition.** Invoice numbers are
sequential, so `INV-2026-04471` and `INV-2026-04472` are one edit apart. An
edit-distance threshold therefore treats every invoice as a near-match to every
other invoice, which produced wrong matches across the whole run. A genuine
transposition is a permutation: same length, same characters, two positions
differ. Anything else is a different invoice.

**Duplicates are held aside before stage 1 and restored afterwards.** Two
identical rows make the "exactly one gateway payment per invoice" lookup
ambiguous, so stages 1 and 2 skipped the invoice entirely and the group was never
matched. The later copy is now held out, the original is matched normally, and
the copy is put back into its group and flagged `DUPLICATE_RECORD`. Nothing is
silently deduped — if nothing claims the original, the copy is returned to the
pool.

**Stage 1 defers anything with a pending reversal.** A chargeback's true group has
four records: invoice, payment, credit and the reversing debit. Clearing three of
them at confidence 1.0 would be a false match, so stage 1 leaves it for the
attachment pass.

**Stage 1 enforces the date window.** A settlement landing four days late is a
real observation about the business. It belongs in stage 2 with a `TIMING_LAG`
note, not cleared silently at confidence 1.0.

**Stage 1 came out stronger than the spec expected.** The spec predicted 60–68%
for stage 1 and 82% cumulative after stage 2. Stage 1 reaches ~75%, so stage 2
has less left to do and cumulative coverage reaches 82% one stage later than
predicted. The tests assert the real shape rather than the predicted one.

---

## Metrics

**Precision counts only groups that assert something.** A group spanning two or
more sources is a claim: "these records go together." A lone invoice with no
payment and no credit is not a claim — it is the system saying "I could not place
this record." Counting the second as a false positive conflates being wrong with
declining to guess, and it dominated the denominator: precision read 0.55 when
almost every one of those was an honest "I don't know."

Nothing is hidden by this. Those groups are still punished in full by recall, via
the truth entry they failed to reconstruct, and they are reported separately as
`declined`. Set equality is still required for a true positive; partial overlap
is still a false positive.

**Calibration excludes exact-tier matches.** They are correct by construction at
confidence 1.0 and would flatter the curve.

---

## Not done

**Stage 4 has never executed against the real API.** No `ANTHROPIC_API_KEY` was
available during the build. The adjudicator, the four-check validation gate, the
prompt builder and the response cache are all written and the gate is covered by
the twelve adversarial contract tests, but `hybrid` and `llm_only` have not been
run end to end. Every committed run artifact is `rules_only`, and the ablation
table reports one row instead of three. This is stated on the ablation panel in
the UI rather than left for a judge to discover.

**Human decisions do not feed back into matching.** They are recorded in
`human_decisions` and never overwrite the agent's decision, so the audit trail
shows both, but nothing learns from a reassignment yet.

---

## Corrections found in an adversarial review pass

These were found by auditing the build against the spec's own Definition of
Done as a hostile reader, after it was first declared finished.

**`escalation_precision` was 1.0000 by construction.** The filter returned true
whenever an escalation had no exact ground-truth twin, so the metric could not
fall below 1.0 no matter how badly the system escalated. It now resolves the
escalation to the truth group its records actually belong to, and an escalation
on a clean, matchable group counts against us. Standard stays at 1.0000; the
hard dataset drops to 0.8681, which is the metric doing its job.

**A run labelled `llm_only` existed with zero LLM calls.** Running a mode that
needs stage 4 without a key silently produced an artifact reporting precision
0.027 under a name claiming the model had run. Both the CLI and the API now
refuse the mode outright and say why, and the ablation file records what was
skipped and for what reason so the short table explains itself.

**Human decisions were written and never read.** The spec's acceptance criterion
is that the audit trail shows both the agent's decision and the human's. They
were being inserted into SQLite and surfaced nowhere, and the queue held them in
React state, so approving a match and reloading lost it. Decisions are now
rehydrated into the queue and rendered on the audit trail beside the agent's own
decision.

**The `runs`, `records` and `matches` tables were never written.** Section 12
specifies them and only `llm_cache` and `human_decisions` were in use. Every run
now persists to SQLite as well as to the JSON artifact, and
`/api/runs/[runId]/matches` serves the filtered, sorted, cursored query the spec
asks for.

**Progress was emitted once per stage, not every 25 records.** Seven jumps
rather than a moving readout. Stages now tick per record examined and the
orchestrator emits every 25, which is 45 events on the standard dataset.

**"Ingest warnings: 0" proved nothing.** The generator never produced a
malformed row, so the defensive ingest path had never met bad input. It now
damages a small share of non-critical amount cells — tax, fee, running balance —
the way a real export does. They land in columns that do not drop the row, so
positional record ids stay aligned with ground truth. Warnings are now 19 on
standard and 85 on hard, and the duplicate rows ingest detects are counted
alongside them instead of being computed and discarded.

### Calibration: three real defects behind one number

Expected calibration error on the hard dataset was 0.31, well over the 0.10 the
spec requires. Fixing it meant fixing what the system believed, not the metric.

**Concluding "missing" from a failed search.** `MISSING_IN_LEDGER` was asserted
at 0.55 confidence and was right about 1% of the time on hard data. The system
was treating "I could not read a reference" as "there is no invoice". A blind
search is now reported as `NARRATION_UNPARSEABLE` at low confidence, which is
what is actually known.

**`MISSING_IN_BANK` claimed money had never arrived, and was wrong 81% of the
time.** The credit was usually sitting unmatched with its reference destroyed.
The engine now looks for an unmatched credit of the right size in the window
whose own reference resolves to nothing, and if one exists it says so, hands the
reviewer the candidate, and rates the two-record group at low confidence —
because seeing a credit that probably belongs is a reason to believe the group
is *incomplete*.

**Calibration was scoring declines.** A lone bank line the system could not
place can never equal a multi-record truth group, so it was counted wrong every
time and dragged the curve down while measuring nothing. Calibration now covers
only matches that assert a grouping, using the same predicate as the precision
denominator, so the two metrics agree on what a claim is.

Two smaller corrections came out of the same pass: confidence in any negative
conclusion is scaled by how legible this run's own narrations were, measured as
the share of bank lines whose references resolve to something the run holds
(0.99 standard, lower on hard) rather than the share carrying any token at all;
and a settlement batch confirmed both by name and by arithmetic was rated 0.88
when it was right on every such match, so double-confirmed batches now carry
0.95 and arithmetic-only batches 0.78.

Result: 0.085 on standard and 0.061 on hard, both inside the bar, with
precision, recall and false-match rate unchanged. No accuracy was traded for it.

### Third pass: things that were written but not wired

Three changes from the second pass had been made in one place and not the other,
which is its own lesson about declaring work finished without re-checking it.

**The "Verify determinism" button was imported and never rendered.** Section
15.2 asks for it, the component and its endpoint both existed, and the JSX was
never added — `npm run lint` found it as an unused import. It now sits under the
run configuration and replays the run in front of the reader: 512 matches in
about 400ms, hashes compared on screen.

**The ablation file recorded no skipped modes** because an earlier guard removed
`llm_only` and `hybrid` from the mode list before the loop that would have
recorded them. All three modes are now always attempted, and the two that cannot
run are named with their reason in the artifact and on the scorecard.

**`npm run lint` reported twenty problems.** Fifteen were from the installed
agent skills under `.claude/`, which are not project source and are now ignored.
The rest were real: dead code left behind by the stage 3 rewrite, and fonts
loaded through a `<link>` tag rather than `next/font`. Fonts are now self-hosted
through `next/font`, so the page makes no third-party request and the tabular
figures are correct on first paint instead of after a swap. Lint is clean.

---

## Fourth pass: the answer to "what happens at ten thousand records?"

The spec prepares an answer to that question: *"Stages 1 and 2 are hash-joins and
scale linearly. Stage 3's subset-sum is the bottleneck."* That answer was not
true of this code. Stage 1 and stage 2 each scanned the entire bank statement
once per invoice, stage 3 rebuilt its settlement batches from every payment in
the window on every credit, and the attachment pass searched every match for
every leftover record. Ten times the data took roughly fifty times as long.

Five indexes fixed it: bank credits by amount, bank debits by amount, gateway
payments by settlement date, settlement batches by total, and matches by every
reference they carry. Stage 1 went from 4,977ms to 147ms at 36,000 records, and
the whole run from 38 seconds to 12.

The narrowing in stage 2 needed an argument rather than a measurement, because
it discards candidates rather than reaching them faster. Stage 2 commits nothing
below the auto-clear threshold; base confidence is 0.98 and an amount outside
tolerance costs 0.30, so any such candidate tops out at 0.68 and can never be
committed however good its reference is. Restricting the scan to the tolerance
band therefore discards only work that would have been thrown away.

The evidence that none of this changed a decision is that both run output hashes
are byte-identical before and after. They are now pinned in
`tests/golden.test.ts` so a future change that alters what the engine decides
fails loudly instead of quietly.

Three smaller corrections from the same pass: `/api/runs/[runId]/matches`
returned 200 with an empty list for a run that does not exist, because SQLite
returns no rows rather than throwing — a caller could not tell "no results" from
"no such run", and it now checks the run first; there was no custom not-found
page, so a mistyped run id got Next's default 404 instead of a list of the runs
that do exist; and a `.git` ownership mismatch on this machine made every git
command fail, which had been hiding whether `runs/` was tracked and
`data/generated/` ignored. Both are correct.
