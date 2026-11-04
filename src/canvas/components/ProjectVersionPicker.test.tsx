import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectVersionPicker } from "./ProjectVersionPicker";
import { projectSession } from "../../test/project-fixture";
afterEach(cleanup);

it("deletes another version without switching to it, and allows removing the final version", async () => {
  const current = projectSession(), other = { ...current, id: "older", title: "Earlier result" };
  const onSelect = vi.fn().mockResolvedValue(undefined), onDelete = vi.fn().mockResolvedValue(undefined);
  const props = { currentId: current.id, zh: false, disabled: false, onSelect, onDelete };
  const { rerender } = render(<ProjectVersionPicker {...props} versions={[current, other]} />);
  fireEvent.click(screen.getByRole("button", { name: "Result versions" }));
  fireEvent.click(screen.getByRole("button", { name: /Delete version Earlier result/ }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledExactlyOnceWith(other.id));
  expect(onSelect).not.toHaveBeenCalled();
  rerender(<ProjectVersionPicker {...props} versions={[current]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Delete version/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Delete version/ }));
  await waitFor(() => expect(onDelete).toHaveBeenLastCalledWith(current.id));
  expect(onSelect).not.toHaveBeenCalled();
});
