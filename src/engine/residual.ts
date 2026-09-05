/**
 * Residual classification: what is left after stages 1-3.
 *
 * These are real groups with a real answer, not a dumping ground - a gateway
 * payment that settled with no bank credit is a MISSING_IN_BANK group of
 * exactly two records, and ground truth says so.
 */

import { daysApart, normalizeRef } from '../ingest/normalize';
import { formatINR } from '../lib/money';
import { evidence, matchReference } from './scoring';
import { commitMatch, openBankRecords, openGatewayRecords, openLedgerRecords, stageEntry, type EngineState } from './state';
import type { CandidateGroup, GatewayRecord, LedgerRecord, StageLogEntry } from '../domain/types';
import type { NormalizedBank } from '../ingest';

/**
 * Confidence in a conclusion of the form "there is nothing here", scaled by how
 * legible the input was. A failed lookup on clean data is real evidence; the
 * same failed lookup on data where four in ten references are destroyed is
 * barely evidence at all.
 */
function negative(state: EngineState, base: number): number {
  return Math.round(base * state.referenceLegibility * 1000) / 1000;
}

/**
 * A credit is a plausible home for an untied payment only if its own reference
 * fails to point somewhere else. A credit carrying a clean, readable invoice
 * number belongs to that invoice; matching on amount and date alone is
 * coincidence, and treating it as evidence made correct MISSING_IN_BANK calls
 * look uncertain when they were right.
 */
function referenceIsDead(state: EngineState, bank: NormalizedBank, invoiceKeys: Set<string>): boolean {
  if (bank.extracted_references.length === 0) return true;
  return !bank.reference_keys.some((key) => invoiceKeys.has(key.full));
}

export function runResidual(state: EngineState): { classified: number; durationMs: number } {
  const started = performance.now();
  const invoiceKeys = new Set(state.ledger.map((l) => normalizeRef(l.invoice_no)));
  let classified = 0;
  const log = (outcome: StageLogEntry['outcome'], note: string): StageLogEntry[] => [
    stageEntry('stage3', outcome, note, 0, performance.now() - started, state.now),
  ];

  // ---- Chargebacks: a debit reversing an earlier settled credit ----
  for (const debit of openBankRecords(state)) {
    if (debit.direction !== 'debit') continue;
    const disputed = state.gateway.filter((g) => g.status === 'disputed' && g.net_paise === debit.amount_paise);
    commitMatch(state, {
      tier: 'unmatched',
      confidence: 0.6,
      ledger_ids: [],
      gateway_ids: [],
      bank_ids: [debit.record_id],
      reconciled_amount_paise: debit.amount_paise,
      variance_paise: 0,
      exception_type: 'CHARGEBACK_DEBIT',
      rationale: 'Debit of ' + formatINR(debit.amount_paise) + ' reverses a previously settled payment.',
      evidence: [
        evidence('Reversing debit', debit.narration, 0.6, [debit.record_id]),
        ...(disputed.length === 1
          ? [evidence('Disputed payment', 'Gateway marks ' + (disputed[0] as GatewayRecord).payment_id + ' disputed.', 0.7, [(disputed[0] as GatewayRecord).record_id])]
          : []),
      ],
      stage_log: log('matched', 'Classified as a chargeback debit.'),
      forceStatus: 'needs_review',
    });
    classified++;
  }

  // ---- Gateway settled, bank has nothing ----
  for (const ledger of openLedgerRecords(state)) {
    const gws = (state.gatewayByReceipt.get(normalizeRef(ledger.invoice_no)) ?? []).filter((g) =>
      state.openGateway.has(g.record_id),
    );
    if (gws.length !== 1) continue;
    const gateway = gws[0] as GatewayRecord;

    /**
     * "The money never arrived" is a strong claim, and it was the wrong one 81%
     * of the time on the hard dataset. Usually the credit is sitting right
     * there and the reference that would tie it was destroyed.
     *
     * So before concluding MISSING_IN_BANK, look for an unmatched credit of the
     * right size in the right window. If one exists, the honest statement is
     * "there is a credit that probably belongs here and we cannot prove it" -
     * a different exception, a much lower confidence, and the candidate handed
     * to the reviewer. The credit is not consumed; claiming it without evidence
     * is what a false match is.
     */
    const plausible = state.bank.filter(
      (b) =>
        state.openBank.has(b.record_id) &&
        b.direction === 'credit' &&
        Math.abs(b.amount_paise - gateway.net_paise) <= state.config.amount_tolerance_paise &&
        daysApart(gateway.settled_at ?? gateway.captured_at, b.value_date) <= state.config.date_window_days + 4 &&
        referenceIsDead(state, b, invoiceKeys),
    );

    const candidates: CandidateGroup[] = plausible.slice(0, state.config.max_candidates).map((b) => ({
      candidate_id: state.nextCandidateId(),
      ledger_ids: [ledger.record_id],
      gateway_ids: [gateway.record_id],
      bank_ids: [b.record_id],
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: gateway.net_paise - b.amount_paise,
      date_gap_days: daysApart(gateway.settled_at ?? gateway.captured_at, b.value_date),
      score: 0.5,
      score_components: {
        amount_proximity: 1,
        date_proximity: 1,
        reference_similarity: 0,
        customer_match: 0,
        method_plausibility: 0.6,
      },
      evidence: [evidence('Amount and date fit', b.narration, 0.5, [b.record_id])],
      rules_note: 'amount and window fit, but no reference ties it to this payment',
      proposed_exception_type: 'NARRATION_UNPARSEABLE',
    }));

    const arrived = plausible.length > 0;

    commitMatch(state, {
      tier: 'unmatched',
      /**
       * If a credit that plausibly belongs here is sitting unmatched, then this
       * two-record group is probably NOT the whole story - which is a reason for
       * low confidence in the grouping, not moderate. When nothing plausible
       * exists, the two-record group really is complete and we can say so.
       */
      confidence: arrived ? negative(state, 0.18) : negative(state, 0.92),
      ledger_ids: [ledger.record_id],
      gateway_ids: [gateway.record_id],
      bank_ids: [],
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: gateway.net_paise,
      exception_type: arrived ? 'NARRATION_UNPARSEABLE' : 'MISSING_IN_BANK',
      rationale: arrived
        ? plausible.length +
          ' unmatched credit' +
          (plausible.length === 1 ? '' : 's') +
          ' of about ' + formatINR(gateway.net_paise) + ' sit in the window, but nothing ties one to this payment.'
        : 'Gateway reports ' + gateway.payment_id + ' settled at ' + formatINR(gateway.net_paise) + ' and no credit of that size arrived at all.',
      evidence: [
        evidence('Invoice and payment agree', 'Receipt matches invoice ' + ledger.invoice_no + '.', 0.9, [ledger.record_id, gateway.record_id]),
        arrived
          ? evidence('Credit present but untied', plausible.length + ' candidate credit(s) match on amount and date only.', 0.4, plausible.map((b) => b.record_id))
          : evidence('No bank credit', 'No open credit matches ' + formatINR(gateway.net_paise) + ' in the window.', 0.8, [gateway.record_id]),
      ],
      ...(candidates.length > 0 ? { candidates } : {}),
      stage_log: log(arrived ? 'ambiguous' : 'matched', arrived ? 'Credit likely present but unprovable.' : 'Settlement never reached the bank.'),
    });
    classified++;
  }

  classified += classifyCredits(state, started, log);
  classified += sweepRemainder(state, started, log);
  return { classified, durationMs: performance.now() - started };
}

type Logger = (outcome: StageLogEntry['outcome'], note: string) => StageLogEntry[];

/** Bank credits with no gateway origin: direct transfer, or money with no invoice. */
function classifyCredits(state: EngineState, _started: number, log: Logger): number {
  let count = 0;
  for (const bank of openBankRecords(state)) {
    if (bank.direction !== 'credit') continue;

    let invoice: LedgerRecord | null = null;
    for (const l of openLedgerRecords(state)) {
      if (!matchReference(bank, [l.invoice_no]).matched) continue;
      if (daysApart(l.issue_date, bank.value_date) > 45) continue;
      invoice = l;
      break;
    }

    const found = invoice !== null;
    const inv = invoice as LedgerRecord;

    /**
     * "No invoice found" only means "missing in ledger" if we could actually
     * have found one. When the narration carries no readable reference at all,
     * the search was blind: the invoice may well exist and we simply cannot see
     * it. Claiming MISSING_IN_LEDGER there was stating 0.55 confidence on a
     * conclusion that held about 1% of the time on the hard dataset.
     *
     * A blind search is reported as UNMATCHED_RESIDUAL at low confidence, which
     * is what we actually know.
     */
    const searchWasBlind = !found && bank.extracted_references.length === 0;

    commitMatch(state, {
      tier: 'unmatched',
      confidence: found ? 0.78 : negative(state, searchWasBlind ? 0.28 : 0.42),
      ledger_ids: found ? [inv.record_id] : [],
      gateway_ids: [],
      bank_ids: [bank.record_id],
      reconciled_amount_paise: bank.amount_paise,
      variance_paise: found ? inv.gross_amount_paise - bank.amount_paise : 0,
      exception_type: found ? 'MISSING_IN_GATEWAY' : searchWasBlind ? 'NARRATION_UNPARSEABLE' : 'MISSING_IN_LEDGER',
      rationale: found
        ? 'Bank credit carries invoice ' + inv.invoice_no + ' but no gateway payment exists. Likely a direct transfer.'
        : searchWasBlind
          ? 'Bank narration carries no readable reference, so this credit could not be searched for an invoice at all.'
          : 'Bank credit of ' + formatINR(bank.amount_paise) + ' has a readable reference that matches no open invoice.',
      evidence: [
        evidence('Bank narration', bank.narration, found ? 0.7 : 0.2, [bank.record_id]),
        ...(found ? [evidence('Invoice reference found', 'Narration names ' + inv.invoice_no + '.', 0.8, [inv.record_id, bank.record_id])] : []),
        ...(searchWasBlind
          ? [evidence('Search was blind', 'No reference token could be extracted, so no invoice lookup was possible.', 0.05, [bank.record_id])]
          : []),
      ],
      stage_log: log(
        searchWasBlind ? 'no_candidate' : 'matched',
        found ? 'Direct credit against a known invoice.' : searchWasBlind ? 'Unreadable narration; no lookup possible.' : 'Unattributed credit.',
      ),
    });
    count++;
  }
  return count;
}

/** Anything still open becomes a one-sided group with an explicit reason. */
function sweepRemainder(state: EngineState, _started: number, log: Logger): number {
  let count = 0;

  for (const ledger of openLedgerRecords(state)) {
    commitMatch(state, {
      tier: 'unmatched',
      confidence: negative(state, 0.3),
      ledger_ids: [ledger.record_id],
      gateway_ids: [],
      bank_ids: [],
      reconciled_amount_paise: ledger.gross_amount_paise,
      variance_paise: ledger.gross_amount_paise,
      exception_type: 'UNMATCHED_RESIDUAL',
      rationale: 'Invoice ' + ledger.invoice_no + ' has no payment and no credit that meets the evidence bar.',
      evidence: [evidence('No candidate', 'Nothing in the gateway or bank pools reconciles to this invoice.', 0.1, [ledger.record_id])],
      stage_log: log('no_candidate', 'No candidate met the evidence bar.'),
    });
    count++;
  }

  for (const gateway of openGatewayRecords(state)) {
    commitMatch(state, {
      tier: 'unmatched',
      confidence: negative(state, 0.3),
      ledger_ids: [],
      gateway_ids: [gateway.record_id],
      bank_ids: [],
      reconciled_amount_paise: gateway.amount_paise,
      variance_paise: gateway.net_paise,
      exception_type: 'MISSING_IN_LEDGER',
      rationale: 'Payment ' + gateway.payment_id + ' has no invoice and no bank credit.',
      evidence: [evidence('Orphan payment', 'Receipt ' + (gateway.receipt ?? '(none)') + ' matches no open invoice.', 0.2, [gateway.record_id])],
      stage_log: log('no_candidate', 'Orphan gateway payment.'),
    });
    count++;
  }

  for (const bank of openBankRecords(state)) {
    commitMatch(state, {
      tier: 'unmatched',
      confidence: negative(state, 0.25),
      ledger_ids: [],
      gateway_ids: [],
      bank_ids: [bank.record_id],
      reconciled_amount_paise: bank.amount_paise,
      variance_paise: 0,
      exception_type: 'UNMATCHED_RESIDUAL',
      rationale: 'Bank line could not be attributed to any invoice or payment.',
      evidence: [evidence('Bank narration', bank.narration, 0.1, [bank.record_id])],
      stage_log: log('no_candidate', 'Unattributed bank line.'),
    });
    count++;
  }

  return count;
}
