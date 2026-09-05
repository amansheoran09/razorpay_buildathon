/**
 * Attachment pass: pull records that belong to an already-matched group into
 * that group rather than leaving them to become separate exceptions.
 *
 * Two cases, both of which are one true group in the source data:
 *   - a duplicated row, exported twice from one system
 *   - a reversing debit that unwinds a settled credit
 *
 * Without this pass the engine reports a correct match plus a spurious extra
 * exception, which is two errors, not one.
 */

import { normalizeRef } from '../ingest/normalize';
import { formatINR } from '../lib/money';
import { evidence, matchReference } from './scoring';
import { openBankRecords, openGatewayRecords, stageEntry, type EngineState } from './state';
import type { MatchGroup } from '../domain/types';

export function runAttach(state: EngineState): { attached: number; durationMs: number } {
  const started = performance.now();
  let attached = 0;

  // One pass to build record id -> owning match. Scanning every match for every
  // leftover record is O(records x matches) and was a quarter of the wall clock
  // at 36,000 records.
  const ownerOf = new Map<string, MatchGroup>();
  for (const m of state.matches) {
    for (const id of m.gateway_ids) ownerOf.set(id, m);
    for (const id of m.bank_ids) ownerOf.set(id, m);
  }

  // Duplicate keys indexed once. Searching the whole source for each leftover
  // record is O(records squared) and was the largest single cost at 36,000.
  const bankKey = (b: { value_date: string; direction: string; amount_paise: number; narration: string }): string =>
    b.value_date + '|' + b.direction + '|' + b.amount_paise + '|' + normalizeRef(b.narration);
  const gatewayKey = (g: { payment_id: string; amount_paise: number; captured_at: string }): string =>
    g.payment_id + '|' + g.amount_paise + '|' + g.captured_at;

  const ownedBankByKey = new Map<string, string>();
  for (const b of state.bank) if (ownerOf.has(b.record_id)) ownedBankByKey.set(bankKey(b), b.record_id);
  const ownedGatewayByKey = new Map<string, string>();
  for (const g of state.gateway) if (ownerOf.has(g.record_id)) ownedGatewayByKey.set(gatewayKey(g), g.record_id);

  const note = (match: MatchGroup, text: string): void => {
    match.stage_log.push(
      stageEntry('stage3', 'matched', text, 0, performance.now() - started, state.now),
    );
  };

  // ---- Duplicated bank rows ----
  for (const bank of openBankRecords(state)) {
    const siblingId = ownedBankByKey.get(bankKey(bank));
    const twin = siblingId && siblingId !== bank.record_id ? ownerOf.get(siblingId) : undefined;
    if (!twin) continue;

    twin.bank_ids = [...twin.bank_ids, bank.record_id].slice().sort();
    twin.exception_type = 'DUPLICATE_RECORD';
    twin.status = 'needs_review';
    twin.confidence = Math.min(twin.confidence, 0.8);
    twin.rationale = 'The same bank credit appears twice with identical narration, amount and posting time.';
    twin.evidence.push(
      evidence('Duplicate bank row', bank.record_id + ' repeats an already-matched credit of ' + formatINR(bank.amount_paise) + '.', 0.9, [bank.record_id]),
    );
    state.openBank.delete(bank.record_id);
    note(twin, 'Attached duplicate bank row ' + bank.record_id + '.');
    attached++;
  }

  // ---- Duplicated gateway rows ----
  for (const gateway of openGatewayRecords(state)) {
    const siblingId = ownedGatewayByKey.get(gatewayKey(gateway));
    const twin = siblingId && siblingId !== gateway.record_id ? ownerOf.get(siblingId) : undefined;
    if (!twin) continue;

    twin.gateway_ids = [...twin.gateway_ids, gateway.record_id].slice().sort();
    twin.exception_type = 'DUPLICATE_RECORD';
    twin.status = 'needs_review';
    twin.confidence = Math.min(twin.confidence, 0.8);
    twin.rationale = 'The same gateway payment appears twice under payment id ' + gateway.payment_id + '.';
    twin.evidence.push(
      evidence('Duplicate gateway row', gateway.record_id + ' repeats ' + gateway.payment_id + '.', 0.9, [gateway.record_id]),
    );
    state.openGateway.delete(gateway.record_id);
    note(twin, 'Attached duplicate gateway row ' + gateway.record_id + '.');
    attached++;
  }

  // ---- Reversing debits ----
  /**
   * Matches indexed by every reference they carry, built once. Scanning every
   * settled match for each debit and rebuilding its reference list each time is
   * O(debits x matches) and dominated the pass at 36,000 records.
   */
  const matchByReference = new Map<string, MatchGroup[]>();
  const addRef = (raw: string | null, match: MatchGroup): void => {
    if (!raw) return;
    const key = normalizeRef(raw);
    if (key.length < 6) return;
    for (const form of [key, key.slice(-6)]) {
      if (form.length < 6) continue;
      const list = matchByReference.get(form);
      if (list) list.push(match);
      else matchByReference.set(form, [match]);
    }
  };
  for (const m of state.matches) {
    if (m.bank_ids.length === 0) continue;
    for (const id of m.ledger_ids) addRef(state.ledgerById.get(id)?.invoice_no ?? null, m);
    for (const id of m.gateway_ids) {
      const g = state.gatewayById.get(id);
      addRef(g?.payment_id ?? null, m);
      addRef(g?.settlement_id ?? null, m);
    }
  }

  for (const debit of openBankRecords(state)) {
    if (debit.direction !== 'debit') continue;

    // Only matches sharing a reference token with this debit are considered.
    const nearby = new Set<MatchGroup>();
    for (const key of debit.reference_keys) {
      for (const m of matchByReference.get(key.full) ?? []) nearby.add(m);
      for (const m of matchByReference.get(key.last6) ?? []) nearby.add(m);
    }

    const target = [...nearby].find((m) =>
      m.bank_ids.some((id) => {
        const credit = state.bankById.get(id);
        return credit !== undefined && credit.direction === 'credit' && credit.amount_paise === debit.amount_paise;
      }),
    );
    if (!target) continue;

    target.bank_ids = [...target.bank_ids, debit.record_id].slice().sort();
    target.exception_type = 'CHARGEBACK_DEBIT';
    target.status = 'needs_review';
    target.confidence = Math.min(target.confidence, 0.75);
    target.rationale = 'A debit of ' + formatINR(debit.amount_paise) + ' reverses the credit that settled this invoice.';
    target.evidence.push(evidence('Reversing debit', debit.narration, 0.85, [debit.record_id]));
    state.openBank.delete(debit.record_id);
    note(target, 'Attached reversing debit ' + debit.record_id + '.');
    attached++;
  }

  return { attached, durationMs: performance.now() - started };
}
