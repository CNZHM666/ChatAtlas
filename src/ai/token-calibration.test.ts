// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { recordTokenSample, resetTokenCalibration, validInputScale, writingInputScale } from "./token-calibration";

beforeEach(() => resetTokenCalibration());

it("stays uncalibrated until enough provider samples exist, then scales by the observed ratio with headroom", () => {
  recordTokenSample("qwen-flash", 10_000, 5_000);
  recordTokenSample("qwen-flash", 10_000, 5_000);
  expect(writingInputScale("qwen-flash")).toBe(1);
  recordTokenSample("qwen-flash", 10_000, 5_000);
  expect(writingInputScale("qwen-flash")).toBe(0.55);
  expect(writingInputScale("other-model")).toBe(1);
  expect(JSON.parse(localStorage.getItem("atlas-token-calibration-v1")!)["qwen-flash"]).toMatchObject({ samples: 3 });
});

it("never raises an estimate, never trusts more than a halving, and ignores tiny or invalid samples", () => {
  for (let index = 0; index < 5; index++) recordTokenSample("under", 1_000, 1_500);
  expect(writingInputScale("under")).toBe(1);
  for (let index = 0; index < 5; index++) recordTokenSample("low-ratio", 10_000, 3_000);
  expect(writingInputScale("low-ratio")).toBe(0.5);
  // Placeholder usage (for example a gateway always reporting 100 tokens) is ignored.
  for (let index = 0; index < 5; index++) recordTokenSample("placeholder", 30_000, 100);
  expect(writingInputScale("placeholder")).toBe(1);
  for (let index = 0; index < 5; index++) { recordTokenSample("noise", 100, 20); recordTokenSample("noise", 10_000, 0); recordTokenSample("noise", undefined, 5); }
  expect(writingInputScale("noise")).toBe(1);
  expect([validInputScale(0.7), validInputScale(0.2), validInputScale(1.5), validInputScale("0.7")]).toEqual([0.7, 1, 1, 1]);
});
