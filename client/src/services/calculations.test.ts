import { describe, expect, it } from "vitest";
import { average, calculatedUnits, chartRows, percentageChange } from "./calculations";
import { domesticSubsidy, estimateBill, estimateTamilNaduBill, inferTamilNaduBillingCycle, normaliseTamilNaduCategory } from "./tariff";
import { predictNextMonth } from "./prediction";
import { parseElectricityBill } from "./billParser";
import type { BillRecord } from "../types";

describe("bill calculations", () => {
  it("calculates non-negative consumption from readings", () => {
    expect(calculatedUnits(12450, 12782)).toBe(332);
    expect(calculatedUnits(10, 2)).toBeNull();
  });
  it("calculates percentage change", () => expect(percentageChange(332, 298)).toBeCloseTo(11.4094, 3));
  it("calculates averages from known values", () => expect(average([100, null, 200, 300])).toBe(200));
  it("groups ISO billing dates by their recorded month", () => {
    const base = { user_id: "test-user", previous_reading: null, current_reading: null, consumer_number: "", customer_name: "", provider: "", meter_number: "", billing_period: "", due_date: "", energy_charge: null, fixed_charge: null, tax: null, other_charge: null, tariff: "", tariff_description: "", ocr_confidence: 1, source_file_path: null, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" } satisfies Omit<BillRecord, "id" | "billing_date" | "units_consumed" | "total_amount">;
    const rows = chartRows([
      { ...base, id: "march-1", billing_date: "2026-03-01", units_consumed: 123, total_amount: 650 },
      { ...base, id: "march-2", billing_date: "2026-03-31", units_consumed: 75, total_amount: 500 },
    ]);
    expect(rows).toEqual([{ period: "Mar 26", units: 198, amount: 1150 }]);
  });
  it("calculates the legacy indicative slab bill", () => expect(estimateBill(100).total).toBeGreaterThan(400));
  it("gives exactly 200 free units at 500 domestic bi-monthly units", () => {
    expect(domesticSubsidy(500, "residential", "bi-monthly")).toMatchObject({ eligible: true, freeUnits: 200, payableUnits: 300 });
    expect(estimateTamilNaduBill(500, "residential", { billingCycle: "bi-monthly" }).energy).toBeCloseTo(200 * 4.7 + 100 * 6.3, 2);
  });
  it("switches to exactly 100 free units at 501 domestic bi-monthly units", () => {
    expect(domesticSubsidy(501, "residential", "bi-monthly")).toMatchObject({ eligible: true, freeUnits: 100, payableUnits: 401 });
    expect(estimateTamilNaduBill(501, "residential", { billingCycle: "bi-monthly" }).energy).toBeCloseTo(300 * 4.7 + 100 * 6.3 + 8.4, 2);
  });
  it("does not apply a monthly allowance or the domestic subsidy to commercial bills", () => {
    expect(domesticSubsidy(500, "commercial", "bi-monthly").freeUnits).toBe(0);
    expect(domesticSubsidy(500, "residential", "monthly").freeUnits).toBe(0);
    expect(estimateTamilNaduBill(200, "residential", { billingCycle: "monthly" }).energy).toBeCloseTo(200 * 4.7, 2);
    expect(estimateTamilNaduBill(251, "residential", { billingCycle: "monthly" }).energy).toBeCloseTo(200 * 4.7 + 50 * 6.3 + 8.4, 2);
  });
  it("infers billing cycle using TNPDCL's 35-day guidance", () => {
    expect(inferTamilNaduBillingCycle("2026-07-01 to 2026-07-31")).toBe("monthly");
    expect(inferTamilNaduBillingCycle("01/07/2026 to 30/08/2026")).toBe("bi-monthly");
    expect(inferTamilNaduBillingCycle("34 days")).toBe("monthly");
    expect(inferTamilNaduBillingCycle("60 days")).toBe("bi-monthly");
    expect(inferTamilNaduBillingCycle()).toBe("bi-monthly");
  });
  it("calculates LT-V payable energy, connected-load bands, and tax", () => {
    const low = estimateTamilNaduBill(100, "commercial", { billingCycle: "bi-monthly", connectedLoadKw: 5 });
    expect(low.energy).toBe(100 * 6.45);
    expect(low.fixed).toBe(110 * 5 * 2);
    expect(low.tax).toBeCloseTo((low.energy + low.fixed) * 0.05, 2);
    const subsidised = estimateTamilNaduBill(500, "commercial", { billingCycle: "bi-monthly", connectedLoadKw: 60 });
    expect(subsidised.energy).toBe(500 * 10.15);
    expect(subsidised.fixed).toBe(332 * 60 * 2);
    expect(subsidised.tax).toBeCloseTo((subsidised.energy + subsidised.fixed) * 0.05, 2);
    const overThreshold = estimateTamilNaduBill(501, "commercial", { billingCycle: "bi-monthly", connectedLoadKw: 5 });
    expect(overThreshold.energy).toBe(501 * 10.45);
    expect(overThreshold.total).toBe(overThreshold.energy + overThreshold.fixed + overThreshold.tax);
    expect(normaliseTamilNaduCategory("LT-V commercial")).toBe("commercial");
    expect(normaliseTamilNaduCategory("Domestic LT-IA")).toBe("residential");
  });
  it("keeps OCR labels separated when parsing a bill transcript", () => {
    const draft = parseElectricityBill("Consumer Number: 1234567890\nCustomer Name: Ananya Sharma\nProvider: PowerGrid Sample Electricity\nMeter Number: MTR-2024-7788\nPrevious Reading: 12450 kWh\nCurrent Reading: 12632 kWh\nUnits Consumed: 182 kWh\nTotal Amount Due: INR 1450.00", 0.9);
    expect(draft.consumer_number).toBe("1234567890");
    expect(draft.customer_name).toBe("Ananya Sharma");
    expect(draft.provider).toBe("PowerGrid Sample Electricity");
    expect(draft.meter_number).toBe("MTR-2024-7788");
    expect(draft.units_consumed).toBe(182);
    expect(draft.total_amount).toBe(1450);
  });
  it("requires history before predicting", () => expect(predictNextMonth([]).predictedUnits).toBeNull());
  it("uses history for a prediction", () => {
    const bills = [210, 220, 230, 240].map((units, index) => ({ id: String(index), user_id: "test-user", billing_date: `2026-0${index + 1}-01`, billing_period: `Month ${index + 1}`, units_consumed: units, previous_reading: null, current_reading: null, total_amount: null, consumer_number: "", customer_name: "", provider: "", meter_number: "", due_date: "", energy_charge: null, fixed_charge: null, tax: null, other_charge: null, tariff: "", tariff_description: "", ocr_confidence: 1, source_file_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) as BillRecord[];
    expect(predictNextMonth(bills).predictedUnits).toBeGreaterThan(240);
  });
});
