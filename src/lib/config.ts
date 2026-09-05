/**
 * Every runtime knob in one place (BUILD_SPEC section 4).
 *
 * All of these are surfaced in the run configuration panel so a judge can see
 * exactly what the system was tuned to. Nothing reads process.env directly
 * outside this file.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(name: string, fallback: number): number {
  return Math.trunc(num(name, fallback));
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export interface SettledConfig {
  llmModel: string;
  llmEnabled: boolean;
  llmCache: boolean;
  llmConcurrency: number;
  llmMaxTokens: number;
  autoClearThreshold: number;
  amountTolerancePaise: number;
  dateWindowDays: number;
  maxCandidates: number;
  subsetSizeCapStandard: number;
  subsetSizeCapHard: number;
  candidatePoolCap: number;
  usdToInr: number;
  apiKeyPresent: boolean;
}

export function loadConfig(): SettledConfig {
  return {
    llmModel: str('SETTLED_LLM_MODEL', 'claude-sonnet-4-6'),
    llmEnabled: bool('SETTLED_LLM_ENABLED', true),
    llmCache: bool('SETTLED_LLM_CACHE', true),
    llmConcurrency: int('SETTLED_LLM_CONCURRENCY', 4),
    llmMaxTokens: int('SETTLED_LLM_MAX_TOKENS', 400),
    autoClearThreshold: num('SETTLED_AUTO_CLEAR_THRESHOLD', 0.9),
    amountTolerancePaise: int('SETTLED_AMOUNT_TOLERANCE_PAISE', 100),
    dateWindowDays: int('SETTLED_DATE_WINDOW_DAYS', 3),
    maxCandidates: int('SETTLED_MAX_CANDIDATES', 5),
    subsetSizeCapStandard: int('SETTLED_SUBSET_CAP_STANDARD', 8),
    subsetSizeCapHard: int('SETTLED_SUBSET_CAP_HARD', 12),
    candidatePoolCap: int('SETTLED_CANDIDATE_POOL_CAP', 40),
    // Pinned, not fetched. A live FX call would make cost figures irreproducible.
    usdToInr: num('SETTLED_USD_INR', 88),
    apiKeyPresent: (process.env.ANTHROPIC_API_KEY ?? '').length > 0,
  };
}

/**
 * Per-million-token USD pricing, keyed by model.
 * Source: Anthropic public pricing. Pinned so cost metrics are reproducible.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function pricingFor(model: string): { input: number; output: number } {
  return MODEL_PRICING_USD_PER_MTOK[model] ?? { input: 3, output: 15 };
}

/**
 * Models from Opus 4.7 onward reject sampling parameters outright. Determinism
 * comes from the prompt-hash cache, not from temperature, so we simply omit
 * the parameter where it is not accepted.
 */
export function supportsTemperature(model: string): boolean {
  return !/^claude-(opus-(5|4-7|4-8)|sonnet-5|fable-5|mythos-5)/.test(model);
}

export const TIMEZONE = 'Asia/Kolkata';
