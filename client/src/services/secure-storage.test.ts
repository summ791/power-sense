import { describe, expect, it } from "vitest";
import { emptyBillDraft, type BillRecord } from "../types";
import { chartRows } from "./calculations";
import { verifyDraft } from "./billParser";
import { predictNextMonth } from "./prediction";
import { deserializeBillRecord, serializeBillDraft } from "./storage";

const ownerId = "2df50d0e-8a2e-47a6-8c9f-8d3347f3db48";

function makeBill(
  id: string,
  date: string,
  units: number,
  amount: number | null
): BillRecord {
  return {
    ...emptyBillDraft,
    id,
    user_id: ownerId,
    billing_date: date,
    billing_period: date.slice(0, 7),
    units_consumed: units,
    total_amount: amount,
    source_file_path: null,
    created_at: `${date}T10:00:00.000Z`,
    updated_at: `${date}T10:00:00.000Z`,
  };
}

describe("authenticated bill persistence and data handling", () => {
  it("stores the authenticated owner, tariff details, and OCR confidence", () => {
    const draft = {
      ...emptyBillDraft,
      tariff: "commercial",
      tariff_description: "LT-V / General purpose",
      ocr_confidence: 0.87,
    };
    const row = serializeBillDraft(
      draft,
      ownerId,
      `${ownerId}/11111111-bill.pdf`,
      "11111111-1111-4111-8111-111111111111",
      "2026-09-27T00:00:00.000Z"
    );
    expect(row.user_id).toBe(ownerId);
    expect(row.tariff_data).toEqual({
      category: "commercial",
      description: "LT-V / General purpose",
    });
    expect(row.ocr_confidence).toEqual({ score: 0.87 });
    expect(row.source_file_path?.startsWith(`${ownerId}/`)).toBe(true);
    expect(row).not.toHaveProperty("session_id");
    expect(row).not.toHaveProperty("tariff");

    const restored = deserializeBillRecord(row);
    expect(restored.user_id).toBe(ownerId);
    expect(restored.tariff).toBe("commercial");
    expect(restored.tariff_description).toBe("LT-V / General purpose");
    expect(restored.ocr_confidence).toBe(0.87);
  });

  it("aggregates multiple saved bills into calendar-month totals", () => {
    const rows = chartRows([
      makeBill("jan-a", "2026-01-02", 100, 650),
      makeBill("jan-b", "2026-01-28", 50, 300),
      makeBill("feb-a", "2026-02-01", 120, 740),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ units: 150, amount: 950 });
    expect(rows[1]).toMatchObject({ units: 120, amount: 740 });
  });

  it("withholds bill forecasts without enough verified historical totals", () => {
    const prediction = predictNextMonth([
      makeBill("jan", "2026-01-01", 100, null),
      makeBill("feb", "2026-02-01", 120, null),
    ]);
    expect(prediction.predictedUnits).not.toBeNull();
    expect(prediction.predictedBillLow).toBeNull();
    expect(prediction.predictedBillHigh).toBeNull();
    expect(prediction.billMethod).toContain("no tariff has been assumed");
  });

  it("fits a bill range only from actual saved monthly totals", () => {
    const prediction = predictNextMonth([
      makeBill("jan", "2026-01-01", 100, 700),
      makeBill("feb", "2026-02-01", 120, 820),
      makeBill("mar", "2026-03-01", 140, 940),
    ]);
    expect(prediction.predictedBillLow).not.toBeNull();
    expect(prediction.predictedBillHigh).not.toBeNull();
    expect(prediction.billMethod).toContain("actual consumption");
  });

  it("rejects impossible dates and detects charge-component mismatches", () => {
    const invalid = verifyDraft({
      ...emptyBillDraft,
      billing_date: "2026-02-31",
    });
    expect(invalid.invalidDate).toBe(true);
    expect(invalid.missingFields).toContain("total amount");

    const inconsistent = verifyDraft({
      ...emptyBillDraft,
      billing_date: "2026-02-28",
      units_consumed: 100,
      energy_charge: 400,
      fixed_charge: 100,
      total_amount: 900,
    });
    expect(inconsistent.inconsistentCharges).toBe(true);
  });
});
