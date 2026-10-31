import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderAssistantText } from "./PowerSenseAssistant";

describe("assistant reply formatting", () => {
  it("renders Markdown emphasis as formatting instead of visible asterisks", () => {
    const markup = renderToStaticMarkup(<>{renderAssistantText("## Bill check\nKeep this normal and make **this bold**. Also *this italic*.")}</>).replace(/\sdata-loc="[^"]*"/g, "");

    expect(markup).toContain("<h3>Bill check</h3>");
    expect(markup).toContain("Keep this normal and make <strong>this bold</strong>.");
    expect(markup).toContain("<em>this italic</em>");
    expect(markup).not.toContain("**");
    expect(markup).not.toContain("*this italic*");
  });

  it("renders lists without exposing their Markdown markers", () => {
    const markup = renderToStaticMarkup(<>{renderAssistantText("Steps:\n- Check the previous reading.\n- Check the current reading.")}</>).replace(/\sdata-loc="[^"]*"/g, "");

    expect(markup).toContain("<p>Steps:</p>");
    expect(markup).toContain("<ul><li>Check the previous reading.</li><li>Check the current reading.</li></ul>");
    expect(markup).not.toContain("- Check");
  });
});
