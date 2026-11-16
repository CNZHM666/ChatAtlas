import { expect, it } from "vitest";
import { domUISnapshot } from "./dom-ui-snapshot";
it("retains responsive layout and current local controls across providers without retaining password values", () => {
  const source = document.createElement("section");
  source.innerHTML = '<div style="display:grid;grid-template-columns:200px 300px"><input type="checkbox"><input type="password" value="private"><select><option>One</option><option>Two</option></select></div>';
  source.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
  source.querySelector("select")!.selectedIndex = 1;
  document.body.append(source);
  const snapshot = domUISnapshot(source);
  expect(snapshot.html).toContain("minmax(0,200fr) minmax(0,300fr)");
  expect(snapshot.html).toContain("checked"); expect(snapshot.html).toContain("selected");
  expect(snapshot.html).not.toContain("private");
  expect(source.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("private");
  source.remove();
});
