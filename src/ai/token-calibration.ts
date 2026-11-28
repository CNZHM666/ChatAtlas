/** Learns how far the conservative local token estimate is from what each model's
 * provider actually reports. Request planners use it where sizing by provider
 * usage is safe. Extraction keeps stable material boundaries so its existing
 * reading caches stay valid. The scale never raises an estimate and is frozen per
 * organization run, so a resumed task rebuilds identical writing requests. */

const STORAGE_KEY = "atlas-token-calibration-v1";
const MIN_SAMPLES = 3;
// Tiny requests are dominated by fixed framing and say little about the tokenizer.
const MIN_ESTIMATE = 500;
const SMOOTHING = 0.2;
// Preserve a floor and extra room for framing and workload variation.
const MIN_SCALE = 0.5;
const HEADROOM = 1.15;
const stages = ["wiki_chapter_fit", "wiki_chapter_write", "wiki_paragraph_revise", "wiki_topic_chains", "wiki_unit_extract"] as const;
type CalibratedStage = typeof stages[number];
const calibratedStages = new Set<string>(stages);

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
export function recordTokenSample(modelId: string, estimated: number | undefined, actual: number | undefined, stage?: string) {
  if (!modelId || !estimated || !actual || estimated < MIN_ESTIMATE || !Number.isFinite(actual) || actual <= 0) return;
  const ratio = actual / estimated;
  // The local estimate is conservative but never 4x too high; a ratio outside this
  // range means a gateway reported placeholder usage, not real tokens.
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) return;
  const store = load();
  for (const key of stage && calibratedStages.has(stage) ? [modelId, `${modelId}:${stage}`] : [modelId]) {
    const previous = store[key];
    store[key] = previous ? { ratio: previous.ratio + SMOOTHING * (ratio - previous.ratio), samples: previous.samples + 1 } : { ratio, samples: 1 };
  }
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Calibration is an optimization only. */ }
}

/** Size writing batches from measured usage. Chapter fit has a conservative
 * cold-start scale for the Qwen model measured on this workload. */
export function writingInputScale(modelId: string | undefined, stage?: CalibratedStage): number {
  const store = load(), specific = modelId && stage ? store[`${modelId}:${stage}`] : undefined;
  const entry = specific && specific.samples >= MIN_SAMPLES ? specific : modelId ? store[modelId] : undefined;
  if (!entry || entry.samples < MIN_SAMPLES) {
    return stage && /(?:^|\/)qwen3\.8-flash$/iu.test(modelId ?? "") ? 0.6 : 1;
  }
  return Math.min(1, Math.max(MIN_SCALE, Math.ceil(entry.ratio * HEADROOM * 100) / 100));
}

/** Accept only scales this module could have produced; anything else means "uncalibrated". */
export const validInputScale = (scale: unknown) => typeof scale === "number" && scale >= MIN_SCALE && scale <= 1 ? scale : 1;

export function resetTokenCalibration() { memory = {}; try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
