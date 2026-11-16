import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReaderDIL } from "./ReaderDIL";
import { dilValue } from "../../shared/dil-values";
afterEach(cleanup);

it("restores local checkbox selection, segmented choices, count and conditional content", () => {
  const source = '{@body const [selected,setSelected]=DIL.useState(["a"])}\n{@body const [depth,setDepth]=DIL.useState("short")}\n{@body const options=[{id:"a",title:"Background"},{id:"b",title:"Decisions"}]}\n<col><title>Choose content</title>{#each options as opt}<checkbox checked={selected.includes(opt.id)} onChange={checked=>setSelected(s=>checked?[...s,opt.id]:s.filter(x=>x!==opt.id))}>{opt.title}</checkbox>{/each}<caption>Selected {selected.length}</caption><segmented-control label="Depth" value={depth} options={["short","full"]} onChange={setDepth} />{#if depth === "full"}<text>Full details</text>{:else}<text>Short details</text>{/if}<button onClick={()=>GenUI.runRemote()}>Remote action</button></col>';
  render(<ReaderDIL source={source} zh={false} />);
  expect(screen.getByRole("checkbox", { name: "Background" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Decisions" }));
  expect(screen.getByText("Selected 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "full" }));
  expect(screen.getByText("Full details")).toBeInTheDocument();
  expect(screen.queryByText("Short details")).toBeNull();
  expect(screen.getByRole("button", { name: "Remote action" })).toBeDisabled();
});
it("does not expose globals, prototypes or execute arbitrary source expressions", () => {
  for (const expression of ["globalThis.location", "window.alert(1)", "x.constructor", "x.__proto__", "({}).constructor.constructor('return 1')()", "(()=>fetch('https://example.test'))()"] ) expect(dilValue(expression, { x: {} })).toBeUndefined();
  expect(dilValue('n + 1', { n: 3 })).toBe(4);
  expect(dilValue('mode === "full" ? "Full" : "Short"', { mode: "short" })).toBe("Short");
});
