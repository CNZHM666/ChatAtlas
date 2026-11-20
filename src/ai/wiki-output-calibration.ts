const STORAGE_KEY = "atlas-wiki-completion-samples-v1";
const MAX_SAMPLES = 24;
const MIN_SAMPLES = 6;

const STAGES = new Set(["wiki_unit_extract", "wiki_unit_merge", "wiki_unit_groups", "wiki_chapter_fit", "wiki_chapter_write"]);
export const isSizedWikiStage = (stage: unknown): stage is string => typeof stage === "string" && STAGES.has(stage);

type Samples = Record<string, number[]>;
let samples: Samples | undefined;
function read(): Samples {
  if (samples) return samples;
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}");
    samples = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { samples = {}; }
  return samples!;
}

export const wikiOutputSamples = (): Samples => ({ ...read() });
function sampleKey(provider: string, model: string, stage: string, planned: number) {
  return JSON.stringify([provider, model, stage, Math.ceil(Math.log2(planned))]);
}

/** Prefer a conservative upper quantile. Sparse history uses the stage's
 * uncalibrated budget. Recovery gets the full planned room. */
export function predictedWikiOutput(snapshot: Samples, provider: string, model: string, stage: string, planned: number) {
  const raw = snapshot[sampleKey(provider, model, stage, planned)];
  const sorted = (Array.isArray(raw) ? raw : []).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length < MIN_SAMPLES) return planned;
  const percentile = sorted[Math.ceil(sorted.length * .85) - 1];
  return Math.min(planned, Math.max(Math.ceil(planned * .7), Math.ceil(percentile * 1.25) + 128));
}

export function recordWikiOutput(provider: string, model: string, stage: string, planned: number, output: number) {
  if (!Number.isFinite(output) || output <= 0 || output > planned) return;
  const key = sampleKey(provider, model, stage, planned), store = read();
  const previous = Array.isArray(store[key]) ? store[key] : [];
  delete store[key];
  store[key] = [...previous.slice(1 - MAX_SAMPLES), output];
  samples = Object.fromEntries(Object.entries(store).slice(-128));
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(samples)); } catch { /* Calibration is optional. */ }
}
