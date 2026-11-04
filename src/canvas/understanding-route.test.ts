import { expect, it } from "vitest";
import { insertUnderstandingCard, understandingRoute } from "./understanding-route";

it("moves only understanding cards, preserves source order and every surviving card across outline changes", () => {
  const route = understandingRoute(["a", "b"], ["x", "y"]);
  const moved = insertUnderstandingCard(route, "x", "b");
  expect(moved.map((entry) => entry.id)).toEqual(["a", "x", "b", "y"]);
  expect(route.map((entry) => entry.id)).toEqual(["a", "b", "x", "y"]);
  expect(understandingRoute(["a", "new", "b"], ["x", "y", "z"], moved).map((entry) => entry.id)).toEqual(["a", "x", "new", "b", "y", "z"]);
  expect(understandingRoute(["a"], ["x", "y"], moved).map((entry) => entry.id)).toEqual(["a", "x", "y"]);
  expect(() => insertUnderstandingCard(moved, "a", "b")).toThrow();
  expect(() => insertUnderstandingCard(moved, "x", "deleted")).toThrow();
});
