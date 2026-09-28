import { describe, expect, it } from "vitest";
import { parseElectricityBill } from "./billParser";

describe("electricity bill parser", () => {
  it("prefers an explicit provider value over generic utility-bill watermark text", () => {
    const result = parseElectricityBill(
      [
        "SYNTHETIC QA BILL - NOT A REAL UTILITY BILL",
        "POWER SENSE QA UTILITY - FICTIONAL TEST PROVIDER",
        "Provider: Power Sense QA Utility (fictional)",
        "Consumer Number: PSQA-TEST-0001",
        "Billing Date: 2026-05-02",
        "Billing Period: April 2026",
        "Tariff Category: Tamil Nadu LT-IA residential (demo only)",
        "Previous Reading: 10000 kWh",
        "Current Reading: 10180 kWh",
        "Units Consumed: 180 kWh",
        "Energy Charge: INR 891.00",
        "Total Amount Due: INR 891.00",
      ].join("\n")
    );

    expect(result.provider).toBe("Power Sense QA Utility (fictional)");
    expect(result.consumer_number).toBe("PSQA-TEST-0001");
    expect(result.billing_date).toBe("2026-05-02");
    expect(result.units_consumed).toBe(180);
    expect(result.total_amount).toBe(891);
    expect(result.tariff).toBe("residential");
  });
});
