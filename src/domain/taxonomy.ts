/**
 * The exception taxonomy (BUILD_SPEC section 7).
 *
 * This is the vocabulary of the entire product. The generator produces these,
 * the engine classifies into these, the UI filters by these, and the metrics
 * report per-category recall on these. One enum, four consumers.
 */

export const EXCEPTION_TYPES = [
  'AMOUNT_MISMATCH',
  'TIMING_LAG',
  'SPLIT_PAYMENT',
  'MERGED_PAYMENT',
  'FEE_DISCREPANCY',
  'REFUND_OFFSET',
  'CHARGEBACK_DEBIT',
  'DUPLICATE_RECORD',
  'MISSING_IN_BANK',
  'MISSING_IN_GATEWAY',
  'MISSING_IN_LEDGER',
  'NARRATION_UNPARSEABLE',
  'UNMATCHED_RESIDUAL',
] as const;

export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export type Severity = 'blocking' | 'review' | 'informational';

export interface ExceptionDefinition {
  type: ExceptionType;
  label: string;
  description: string;
  severity: Severity;
  blocks_auto_clear: boolean;
  suggested_action: string;
  typical_cause: string;
}

export const EXCEPTION_DEFINITIONS: Record<ExceptionType, ExceptionDefinition> = {
  AMOUNT_MISMATCH: {
    type: 'AMOUNT_MISMATCH',
    label: 'Amount mismatch',
    description: 'The three sources disagree on the amount by more than tolerance.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Check the invoice for a credit note or a late discount, then correct the ledger.',
    typical_cause: 'A discount or adjustment applied after the invoice was raised.',
  },
  TIMING_LAG: {
    type: 'TIMING_LAG',
    label: 'Timing lag',
    description: 'Payment and settlement fall in different periods; amounts agree.',
    severity: 'informational',
    blocks_auto_clear: false,
    suggested_action: 'No action. Carry the amount into the next period close.',
    typical_cause: 'Capture landed after the gateway settlement cut-off.',
  },
  SPLIT_PAYMENT: {
    type: 'SPLIT_PAYMENT',
    label: 'Split payment',
    description: 'One invoice was paid across multiple credits.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Confirm the instalments cover the invoice in full, then mark it paid.',
    typical_cause: 'The customer paid in parts, or the gateway split a large capture.',
  },
  MERGED_PAYMENT: {
    type: 'MERGED_PAYMENT',
    label: 'Merged payment',
    description: 'One credit covers multiple invoices.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Confirm the invoice set this credit covers, then split it in the ledger.',
    typical_cause: 'The gateway settled a batch of captures as a single bank transfer.',
  },
  FEE_DISCREPANCY: {
    type: 'FEE_DISCREPANCY',
    label: 'Fee discrepancy',
    description: 'Gateway fee differs from the expected rate for this method.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Compare against the pricing agreement for this method and raise it with the gateway.',
    typical_cause: 'A negotiated rate change, or a method-specific surcharge.',
  },
  REFUND_OFFSET: {
    type: 'REFUND_OFFSET',
    label: 'Refund offset',
    description: 'A refund was netted inside a settlement batch.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Identify the refunded payment and post the reversal against the original invoice.',
    typical_cause: 'The gateway deducted a refund from the same day settlement.',
  },
  CHARGEBACK_DEBIT: {
    type: 'CHARGEBACK_DEBIT',
    label: 'Chargeback debit',
    description: 'A debit reverses a previously settled payment.',
    severity: 'blocking',
    blocks_auto_clear: true,
    suggested_action: 'Reopen the invoice, attach the dispute reference, and start the evidence process.',
    typical_cause: 'The customer disputed the charge with their card issuer.',
  },
  DUPLICATE_RECORD: {
    type: 'DUPLICATE_RECORD',
    label: 'Duplicate record',
    description: 'The same transaction appears twice in one source.',
    severity: 'blocking',
    blocks_auto_clear: true,
    suggested_action: 'Keep the earlier record, void the duplicate, and note which one you kept.',
    typical_cause: 'A retried export, or a double submission at capture.',
  },
  MISSING_IN_BANK: {
    type: 'MISSING_IN_BANK',
    label: 'Missing in bank',
    description: 'Gateway reports settled, bank shows no corresponding credit.',
    severity: 'blocking',
    blocks_auto_clear: true,
    suggested_action: 'Check the settlement is not still in transit, then raise it with the gateway.',
    typical_cause: 'Settlement failed, was held, or landed in a different account.',
  },
  MISSING_IN_GATEWAY: {
    type: 'MISSING_IN_GATEWAY',
    label: 'Missing in gateway',
    description: 'Bank credit with no gateway origin, likely a direct transfer.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Trace the credit to a customer and post it against their open invoices.',
    typical_cause: 'The customer paid by NEFT straight into the bank account.',
  },
  MISSING_IN_LEDGER: {
    type: 'MISSING_IN_LEDGER',
    label: 'Missing in ledger',
    description: 'Money received with no matching invoice.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Find out what this payment was for and raise the missing invoice.',
    typical_cause: 'An advance, or an invoice that was never entered.',
  },
  NARRATION_UNPARSEABLE: {
    type: 'NARRATION_UNPARSEABLE',
    label: 'Narration unreadable',
    description: 'Bank narration carries no usable reference.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Match it by amount and date, or ask the bank for the full remittance detail.',
    typical_cause: 'The bank truncated the narration field on export.',
  },
  UNMATCHED_RESIDUAL: {
    type: 'UNMATCHED_RESIDUAL',
    label: 'Unmatched',
    description: 'No candidate met the evidence bar.',
    severity: 'review',
    blocks_auto_clear: true,
    suggested_action: 'Review the surrounding period by hand and decide where this belongs.',
    typical_cause: 'Several small problems at once, or a record from outside this period.',
  },
};

export function isExceptionType(value: unknown): value is ExceptionType {
  return typeof value === 'string' && (EXCEPTION_TYPES as readonly string[]).includes(value);
}

export function blocksAutoClear(type: ExceptionType | null): boolean {
  if (type === null) return false;
  return EXCEPTION_DEFINITIONS[type].blocks_auto_clear;
}

export function severityOf(type: ExceptionType | null): Severity {
  if (type === null) return 'informational';
  return EXCEPTION_DEFINITIONS[type].severity;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  blocking: 0,
  review: 1,
  informational: 2,
};
