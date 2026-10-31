import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { answerForCalculation, isPersonalBillQuestion, renderAssistantText } from "./PowerSenseAssistant";

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

  it("shares account bill context only for questions that refer to the user's own bills", () => {
    expect(isPersonalBillQuestion("What was my electricity bill last month?")).toBe(true);
    expect(isPersonalBillQuestion("Compare my saved usage history.")).toBe(true);
    expect(isPersonalBillQuestion("How does the Tamil Nadu subsidy work?")).toBe(false);
    expect(isPersonalBillQuestion("How do I calculate electricity units?")).toBe(false);
  });

  it("does not replace a factual units question with an unrelated bill estimate", () => {
    expect(answerForCalculation("What does 200 units mean?")).toBeNull();
  });

  it("answers meter-reading and bill-estimate requests briefly and directly", () => {
    const units = answerForCalculation("Previous reading 1200, current reading 1325") ?? "";
    const estimate = answerForCalculation("Estimate bill amount for 300 units residential bi-monthly") ?? "";

    expect(units).toContain("125 kWh");
    expect(units.split(/\s+/).length).toBeLessThan(20);
    expect(estimate).toContain("Estimated bill: ₹");
    expect(estimate).toContain("200 free units; 100 payable.");
    expect(estimate.split(/\s+/).length).toBeLessThan(35);
    expect(answerForCalculation("Estimate bill amount for 300 units bi-monthly")).toContain("assuming residential");
  });
});
