import { describe, expect, it } from "vitest";
import { sharedTrunkX } from "../edge-geometry";

describe("orthogonal branch trunk", () => {
  it("shares one trunk coordinate for sibling targets", () => {
    expect(sharedTrunkX(292, [636, 636, 636])).toBe(336);
    expect(sharedTrunkX(292, [350, 350])).toBe(321);
  });
});
