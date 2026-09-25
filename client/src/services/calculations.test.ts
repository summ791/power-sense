import { describe, expect, it } from "vitest";
import { calculatedUnits, percentageChange, average } from "./calculations";
import { estimateBill, estimateTamilNaduBill, normaliseTamilNaduCategory } from "./tariff";
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
  it("calculates the legacy indicative slab bill", () => expect(estimateBill(100).total).toBeGreaterThan(400));
  it("calculates Tamil Nadu residential slabs progressively", () => {
    const estimate = estimateTamilNaduBill(450, "residential", { billingCycle: "bi-monthly" });
    expect(estimate.energy).toBeCloseTo(400 * 4.95 + 50 * 6.65, 2);
    expect(estimate.fixed).toBe(0);
  });
  it("calculates Tamil Nadu commercial threshold and fixed load charge", () => {
    const estimate = estimateTamilNaduBill(120, "commercial", { billingCycle: "bi-monthly", connectedLoadKw: 5 });
    expect(estimate.energy).toBe(120 * 10.45);
    expect(estimate.fixed).toBe(110 * 5 * 2);
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
    const bills = [210, 220, 230, 240].map((units, index) => ({ id: String(index), session_id: "test", billing_date: `2026-0${index + 1}-01`, billing_period: `Month ${index + 1}`, units_consumed: units, previous_reading: null, current_reading: null, total_amount: null, consumer_number: "", customer_name: "", provider: "", meter_number: "", due_date: "", energy_charge: null, fixed_charge: null, tax: null, other_charge: null, tariff: "residential", ocr_confidence: 1, source_file_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) as BillRecord[];
    expect(predictNextMonth(bills).predictedUnits).toBeGreaterThan(240);
  });
});
