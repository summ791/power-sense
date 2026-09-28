import { describe, expect, it } from "vitest";
import { parseElectricityBill, verifyDraft } from "./billParser";

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

  it("maps Tamil Nadu reading and charge values from aligned OCR table columns", () => {
    const draft = parseElectricityBill(
      [
        "Tamil Nadu Power Distribution Corporation Limited",
        "Consumer Number: TN-TEST-0001",
        "Bill Date: 2026-08-02",
        "Billing Period: July 2026",
        "",
        "Previous Reading         Current Reading         Units Consumed",
        "10,600                   10,810                 210",
        "",
        "Energy Charge     Fixed Charge     Electricity Duty / Tax     Other Charges     Total Amount Payable",
        "780.00            100.00           96.50                     80.00             1,056.50",
      ].join("\n"),
      0.94
    );

    expect(draft.provider).toBe(
      "Tamil Nadu Power Distribution Corporation Limited"
    );
    expect(draft.previous_reading).toBe(10600);
    expect(draft.current_reading).toBe(10810);
    expect(draft.units_consumed).toBe(210);
    expect(draft.energy_charge).toBe(780);
    expect(draft.fixed_charge).toBe(100);
    expect(draft.tax).toBe(96.5);
    expect(draft.other_charge).toBe(80);
    expect(draft.total_amount).toBe(1056.5);
    expect(verifyDraft(draft)).toMatchObject({
      calculated: 210,
      mismatch: false,
      inconsistentCharges: false,
    });
  });

  it("keeps adjacent same-line readings and charge fields separate", () => {
    const draft = parseElectricityBill(
      [
        "Previous Reading: 10,600 Current Reading: 10,810 Units Consumed: 210",
        "Energy Charge: INR 780.00 Fixed Charge: INR 100.00 Electricity Duty / Tax: INR 96.50 Other Charges: INR 80.00 Total Amount Payable: INR 1,056.50",
      ].join("\n")
    );

    expect(draft).toMatchObject({
      previous_reading: 10600,
      current_reading: 10810,
      units_consumed: 210,
      energy_charge: 780,
      fixed_charge: 100,
      tax: 96.5,
      other_charge: 80,
      total_amount: 1056.5,
    });
    expect(verifyDraft(draft)).toMatchObject({
      mismatch: false,
      inconsistentCharges: false,
    });
  });

  it("keeps extracted units separate from calculated readings and preserves both warnings", () => {
    const draft = parseElectricityBill(
      [
        "Previous Reading: 10000",
        "Current Reading: 10210",
        "Units Consumed: 205",
        "Energy Charge: 800.00",
        "Fixed Charge: 100.00",
        "Electricity Duty / Tax: 25.00",
        "Other Charges: 25.00",
        "Total Amount Payable: 1100.00",
      ].join("\n")
    );

    expect(draft.units_consumed).toBe(205);
    expect(verifyDraft(draft)).toMatchObject({
      calculated: 210,
      mismatch: true,
      inconsistentCharges: true,
    });
  });

  it("does not borrow a neighboring current reading when the previous value is absent", () => {
    const draft = parseElectricityBill(
      [
        "Previous Reading:",
        "Current Reading: 10810",
        "Units Consumed: 210",
      ].join("\n")
    );

    expect(draft.previous_reading).toBeNull();
    expect(draft.current_reading).toBe(10810);
    expect(draft.units_consumed).toBe(210);
  });

  it("normalizes TANGEDCO to the requested full provider name", () => {
    const draft = parseElectricityBill(
      "Provider: TANGEDCO\nUnits Consumed: 210"
    );
    expect(draft.provider).toBe(
      "Tamil Nadu Power Distribution Corporation Limited"
    );
  });
});
