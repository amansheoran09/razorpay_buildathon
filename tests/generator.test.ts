import { describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import { hashObject } from '../src/lib/hash';
import { parseRupees, tryParseRupees } from '../src/lib/money';
import { SCENARIOS, STANDARD_PROFILE } from '../src/generator/profiles';

function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = text.trimEnd().split('\n');
  const header = (lines[0] as string).split(',');
  const rows = lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i] as string;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
  return { header, rows };
}

const standard = generate({ dataset: 'standard', seed: 42, count: 500 });

describe('determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    const again = generate({ dataset: 'standard', seed: 42, count: 500 });
    expect(again.ledgerCsv).toBe(standard.ledgerCsv);
    expect(again.gatewayCsv).toBe(standard.gatewayCsv);
    expect(again.bankCsv).toBe(standard.bankCsv);
    expect(hashObject(again.groundTruth)).toBe(hashObject(standard.groundTruth));
  });

  it('produces different data for a different seed', () => {
    const other = generate({ dataset: 'standard', seed: 43, count: 500 });
    expect(other.bankCsv).not.toBe(standard.bankCsv);
  });
});

describe('ground truth', () => {
  it('has one entry per generated group', () => {
    expect(standard.groundTruth.entries.length).toBe(500);
    expect(standard.counts.groups).toBe(500);
  });

  it('names every record exactly once across all entries', () => {
    const seen = new Set<string>();
    for (const entry of standard.groundTruth.entries) {
      for (const id of [...entry.ledger_ids, ...entry.gateway_ids, ...entry.bank_ids]) {
        expect(seen.has(id), 'duplicate id ' + id).toBe(false);
        seen.add(id);
      }
    }
    const total = standard.counts.ledger + standard.counts.gateway + standard.counts.bank;
    expect(seen.size).toBe(total);
  });

  it('references ids that fall inside the emitted range for each source', () => {
    for (const entry of standard.groundTruth.entries) {
      for (const id of entry.ledger_ids) {
        expect(Number(id.slice(4))).toBeLessThanOrEqual(standard.counts.ledger);
      }
      for (const id of entry.gateway_ids) {
        expect(Number(id.slice(3))).toBeLessThanOrEqual(standard.counts.gateway);
      }
      for (const id of entry.bank_ids) {
        expect(Number(id.slice(4))).toBeLessThanOrEqual(standard.counts.bank);
      }
    }
  });
});

describe('scenario mix', () => {
  it('lands within 1.5 percentage points of every target', () => {
    for (const name of SCENARIOS) {
      const actual = ((standard.scenarioCounts[name] ?? 0) / 500) * 100;
      const target = STANDARD_PROFILE.mix[name];
      expect(Math.abs(actual - target), name + ': ' + actual + ' vs ' + target).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('bank statement', () => {
  const { rows } = parseCsv(standard.bankCsv);

  /**
   * The generator deliberately writes a small share of balance cells as garbage,
   * the way a real export does. The running total must still tie wherever two
   * consecutive balances are both readable.
   */
  it('forms a consistent running balance wherever the balance is readable', () => {
    let checked = 0;
    for (let i = 1; i < rows.length; i++) {
      const previous = tryParseRupees(rows[i - 1]!.balance as string);
      const balance = tryParseRupees(rows[i]!.balance as string);
      const amount = tryParseRupees(rows[i]!.amount as string);
      if (previous === null || balance === null || amount === null) continue;
      const delta = rows[i]!.type === 'CR' ? amount : -amount;
      expect(balance).toBe(previous + delta);
      checked++;
    }
    expect(checked).toBeGreaterThan(rows.length * 0.9);
  });

  it('deliberately damages some cells, so the ingest warning path is real', () => {
    const damaged = rows.filter((r) => tryParseRupees(r.balance as string) === null);
    expect(damaged.length).toBeGreaterThan(0);
    expect(damaged.length).toBeLessThan(rows.length * 0.05);
  });

  it('is ordered by posting time', () => {
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i]!.posted_at as string) >= (rows[i - 1]!.posted_at as string)).toBe(true);
    }
  });

  it('has both credits and debits', () => {
    expect(rows.some((r) => r.type === 'CR')).toBe(true);
    expect(rows.some((r) => r.type === 'DR')).toBe(true);
  });

  it('parses every amount as exact paise', () => {
    for (const row of rows) expect(Number.isSafeInteger(parseRupees(row.amount as string))).toBe(true);
  });
});

describe('hard dataset', () => {
  const hard = generate({ dataset: 'hard', seed: 42, count: 500 });

  it('is meaningfully harder than standard', () => {
    const cleanShare = (hard.scenarioCounts.clean ?? 0) / 500;
    expect(cleanShare).toBeLessThan(0.35);
  });

  it('contains genuinely undecidable groups', () => {
    expect(hard.groundTruth.entries.some((e) => !e.is_resolvable)).toBe(true);
  });

  it('loses the reference on far more bank lines than standard', () => {
    const missing = (csvText: string): number => {
      const { rows } = parseCsv(csvText);
      return rows.filter((r) => (r.reference_no ?? '') === '').length / rows.length;
    };
    expect(missing(hard.bankCsv)).toBeGreaterThan(missing(standard.bankCsv) * 1.5);
  });
});
