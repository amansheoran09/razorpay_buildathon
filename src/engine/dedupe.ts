/**
 * Duplicate pre-pass.
 *
 * A row exported twice blocks stage 1 and stage 2 outright: both look for
 * exactly one gateway payment per invoice, and two identical rows make the
 * lookup ambiguous. So duplicates are identified up front, the later copy is
 * held aside, and it is re-attached to whichever group claims the original.
 *
 * Nothing is silently deduped. The shadow record is always restored to its
 * group and the group is flagged DUPLICATE_RECORD for a human.
 */

import { normalizeRef } from '../ingest/normalize';
import { formatINR } from '../lib/money';
import { evidence } from './scoring';
import { stageEntry, type EngineState } from './state';

export interface Shadow {
  shadowId: string;
  primaryId: string;
  source: 'gateway' | 'bank';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function findShadows(state: EngineState): Shadow[] {
  const shadows: Shadow[] = [];

  const gatewayGroups = groupBy(
    state.gateway,
    (g) => g.payment_id + '|' + g.amount_paise + '|' + g.captured_at,
  );
  for (const list of gatewayGroups.values()) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => (a.record_id < b.record_id ? -1 : 1));
    for (const extra of sorted.slice(1)) {
      shadows.push({ shadowId: extra.record_id, primaryId: (sorted[0] as { record_id: string }).record_id, source: 'gateway' });
    }
  }

  const bankGroups = groupBy(
    state.bank,
    (b) => b.value_date + '|' + b.direction + '|' + b.amount_paise + '|' + normalizeRef(b.narration),
  );
  for (const list of bankGroups.values()) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => (a.record_id < b.record_id ? -1 : 1));
    for (const extra of sorted.slice(1)) {
      shadows.push({ shadowId: extra.record_id, primaryId: (sorted[0] as { record_id: string }).record_id, source: 'bank' });
    }
  }

  return shadows;
}

/** Hold the later copies aside so stages 1-3 see an unambiguous world. */
export function holdShadows(state: EngineState, shadows: Shadow[]): void {
  for (const shadow of shadows) {
    if (shadow.source === 'gateway') state.openGateway.delete(shadow.shadowId);
    else state.openBank.delete(shadow.shadowId);
  }
}

/** Put every held record back into the group that claimed its original. */
export function restoreShadows(state: EngineState, shadows: Shadow[], startedAt: number): number {
  let restored = 0;
  for (const shadow of shadows) {
    const owner = state.matches.find((m) =>
      shadow.source === 'gateway' ? m.gateway_ids.includes(shadow.primaryId) : m.bank_ids.includes(shadow.primaryId),
    );
    if (!owner) {
      // Nothing claimed the original, so put the copy back in play.
      if (shadow.source === 'gateway') state.openGateway.add(shadow.shadowId);
      else state.openBank.add(shadow.shadowId);
      continue;
    }

    if (shadow.source === 'gateway') owner.gateway_ids = [...owner.gateway_ids, shadow.shadowId].slice().sort();
    else owner.bank_ids = [...owner.bank_ids, shadow.shadowId].slice().sort();

    const amount =
      shadow.source === 'gateway'
        ? (state.gatewayById.get(shadow.shadowId)?.amount_paise ?? 0)
        : (state.bankById.get(shadow.shadowId)?.amount_paise ?? 0);

    owner.exception_type = 'DUPLICATE_RECORD';
    owner.status = 'needs_review';
    owner.confidence = Math.min(owner.confidence, 0.8);
    owner.rationale =
      'The same ' + shadow.source + ' record appears twice. ' + shadow.shadowId + ' repeats ' + shadow.primaryId + '.';
    owner.evidence.push(
      evidence(
        'Duplicate row',
        shadow.shadowId + ' duplicates ' + shadow.primaryId + ' at ' + formatINR(amount) + '.',
        0.9,
        [shadow.shadowId, shadow.primaryId],
      ),
    );
    owner.stage_log.push(
      stageEntry('stage3', 'matched', 'Restored duplicate ' + shadow.shadowId + ' into this group.', 0, performance.now() - startedAt, state.now),
    );
    restored++;
  }
  return restored;
}
