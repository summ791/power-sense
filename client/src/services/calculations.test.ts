import { describe, expect, it } from "vitest";
import { calculatedUnits, percentageChange, average } from "./calculations";
import { estimateBill } from "./tariff";
import { predictNextMonth } from "./prediction";
import type { BillRecord } from "../types";

describe("bill calculations", () => {
  it("calculates non-negative consumption from readings", () => {
    expect(calculatedUnits(12450, 12782)).toBe(332);
    expect(calculatedUnits(10, 2)).toBeNull();
  });
  it("calculates percentage change", () => expect(percentageChange(332, 298)).toBeCloseTo(11.4094, 3));
  it("calculates averages from known values", () => expect(average([100, null, 200, 300])).toBe(200));
  it("calculates an indicative slab bill", () => expect(estimateBill(100).total).toBeGreaterThan(400));
  it("requires history before predicting", () => expect(predictNextMonth([]).predictedUnits).toBeNull());
  it("uses history for a prediction", () => {
    const bills = [210, 220, 230, 240].map((units, index) => ({ id: String(index), session_id: "test", billing_date: `2026-0${index + 1}-01`, billing_period: `Month ${index + 1}`, units_consumed: units, previous_reading: null, current_reading: null, total_amount: null, consumer_number: "", customer_name: "", provider: "", meter_number: "", due_date: "", energy_charge: null, fixed_charge: null, tax: null, other_charge: null, tariff: "", ocr_confidence: 1, source_file_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) as BillRecord[];
    expect(predictNextMonth(bills).predictedUnits).toBeGreaterThan(240);
  });
});
