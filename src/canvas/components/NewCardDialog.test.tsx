import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { NewCardDialog } from "./NewCardDialog";

describe("new card dialog", () => {
  it("creates one generic card from a title and optional content", () => {
    localStorage.setItem("atlas-locale", "en");
    const onCreate = vi.fn();
    render(<PreferencesProvider><NewCardDialog onClose={vi.fn()} onCreate={onCreate} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: /topic|bridge|note/i })).not.toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create card" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "New idea" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Content/ }), { target: { value: "One thought" } });
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith("New idea", "One thought");
  });
});
