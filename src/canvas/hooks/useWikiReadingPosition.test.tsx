import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useWikiReadingPosition } from "./useWikiReadingPosition";

afterEach(() => { cleanup(); localStorage.removeItem("atlas-wiki-reading:position-test"); });
function Page({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useWikiReadingPosition(ref, "position-test", id, enabled);
  return <main ref={ref} data-testid="reader"><div>{id}</div></main>;
}
it("remembers each page separately and restores the prior position when returning", () => {
  const view = render(<Page id="one" />), element = screen.getByTestId("reader");
  fireEvent.wheel(element); element.scrollTop = 340; fireEvent.scroll(element);
  view.rerender(<Page id="two" />);
  expect(element.scrollTop).toBe(0);
  fireEvent.wheel(element); element.scrollTop = 90; fireEvent.scroll(element);
  view.rerender(<Page id="one" />);
  expect(element.scrollTop).toBe(340);
  view.unmount();
  expect(JSON.parse(localStorage.getItem("atlas-wiki-reading:position-test")!)).toMatchObject({ one: 340, two: 90 });
});
it("ignores malformed saved values and does not write overview positions", () => {
  localStorage.setItem("atlas-wiki-reading:position-test", '{"one":-90}');
  const view = render(<Page id="one" />); expect(screen.getByTestId("reader").scrollTop).toBe(0);
  view.rerender(<Page id="overview" enabled={false} />);
  const element = screen.getByTestId("reader"); fireEvent.wheel(element); element.scrollTop = 77; fireEvent.scroll(element);
  view.unmount(); expect(JSON.parse(localStorage.getItem("atlas-wiki-reading:position-test")!)).not.toHaveProperty("overview");
});
