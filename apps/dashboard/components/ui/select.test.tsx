import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select } from "./select";

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return render(
    <Select aria-label="model" defaultValue="b" {...props}>
      <option value="a">a-short</option>
      <option value="b">claude-opus-4-7-a-very-long-option-label</option>
    </Select>,
  );
}

describe("Select", () => {
  it("renders a native select so mobile gets the platform picker", () => {
    renderSelect();
    expect(screen.getByRole("combobox")).toBeInstanceOf(HTMLSelectElement);
  });

  // The whole point of GOL-2651: a flex item defaults to `min-width: auto`,
  // so without min-w-0 the select refuses to shrink below its widest option
  // and drags the page into horizontal overflow.
  it("can shrink below its widest option (min-w-0)", () => {
    renderSelect();
    expect(screen.getByRole("combobox").className).toContain("min-w-0");
  });

  it("is a 44px touch target on mobile and dense on desktop", () => {
    const cls = renderSelect().container.querySelector("select")!.className;
    expect(cls).toContain("h-11");
    expect(cls).toContain("sm:h-8");
  });

  it("suppresses native chrome and draws the design-system chevron", () => {
    const { container } = renderSelect();
    expect(container.querySelector("select")!.className).toContain("appearance-none");
    const chevron = container.querySelector("svg");
    expect(chevron).not.toBeNull();
    // Decorative: the select itself carries the accessible name.
    expect(chevron!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a visible focus ring", () => {
    const cls = renderSelect().container.querySelector("select")!.className;
    expect(cls).toContain("focus-visible:ring-3");
    expect(cls).toContain("focus-visible:border-ring");
  });

  it("forwards props and merges caller classes", () => {
    renderSelect({ id: "model-opus", className: "font-mono", disabled: true });
    const el = screen.getByRole("combobox");
    expect(el.id).toBe("model-opus");
    expect(el.className).toContain("font-mono");
    expect(el).toBeDisabled();
  });
});
