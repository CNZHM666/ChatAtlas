/** Learns how far the conservative local token estimate is from what each model's
 * provider actually reports. Only Wiki writing uses it, to size its batches by
 * real tokens; reading batches keep their uncalibrated boundaries so existing
 * reading caches stay valid. The scale never raises an estimate and is frozen per
 * organization run, so a resumed task rebuilds identical writing requests. */

const STORAGE_KEY = "atlas-token-calibration-v1";
const MIN_SAMPLES = 3;
// Tiny requests are dominated by fixed framing and say little about the tokenizer.
const MIN_ESTIMATE = 500;
const SMOOTHING = 0.2;
// Never trust the estimate to be more than twice too large, and keep 10% headroom.
const MIN_SCALE = 0.5;
const HEADROOM = 1.1;

type Calibration = Record<string, { ratio: number; samples: number }>;
let memory: Calibration | undefined;

function load(): Calibration {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}") as Calibration;
    memory = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { memory = {}; }
  return memory;
}

/** Record one provider-reported request: actual input tokens against the local estimate. */
export function recordTokenSample(modelId: string, estimated: number | undefined, actual: number | undefined) {
  if (!modelId || !estimated || !actual || estimated < MIN_ESTIMATE || !Number.isFinite(actual) || actual <= 0) return;
  const ratio = actual / estimated;
  // The local estimate is conservative but never 4x too high; a ratio outside this
  // range means a gateway reported placeholder usage, not real tokens.
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) return;
  const store = load(), previous = store[modelId];
  store[modelId] = previous ? { ratio: previous.ratio + SMOOTHING * (ratio - previous.ratio), samples: previous.samples + 1 } : { ratio, samples: 1 };
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Calibration is an optimization only. */ }
}

/** Multiplier applied to estimated input tokens when sizing writing batches: 1 until enough samples exist. */
export function writingInputScale(modelId: string | undefined): number {
  const entry = modelId ? load()[modelId] : undefined;
  if (!entry || entry.samples < MIN_SAMPLES) return 1;
  return Math.round(Math.min(1, Math.max(MIN_SCALE, entry.ratio * HEADROOM)) * 100) / 100;
}

/** Accept only scales this module could have produced; anything else means "uncalibrated". */
export const validInputScale = (scale: unknown) => typeof scale === "number" && scale >= MIN_SCALE && scale <= 1 ? scale : 1;

export function resetTokenCalibration() { memory = {}; try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
