export type BillDraft = {
  consumer_number: string;
  customer_name: string;
  provider: string;
  meter_number: string;
  billing_date: string;
  billing_period: string;
  due_date: string;
  previous_reading: number | null;
  current_reading: number | null;
  units_consumed: number | null;
  energy_charge: number | null;
  fixed_charge: number | null;
  tax: number | null;
  other_charge: number | null;
  total_amount: number | null;
  /** Explicit Tamil Nadu estimate category; blank means tariff is unknown. */
  tariff: string;
  /** OCR/user-verified tariff or slab label as it appears on the bill. */
  tariff_description: string;
  ocr_confidence: number;
};

export type BillRecord = BillDraft & {
  id: string;
  session_id: string;
  source_file_path: string | null;
  created_at: string;
  updated_at: string;
};

export type PredictionResult = {
  predictedUnits: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  predictedBillLow: number | null;
  predictedBillHigh: number | null;
  billMethod?: string;
  method: string;
  basis: string;
  mae: number | null;
  mape: number | null;
  message?: string;
};

export const emptyBillDraft: BillDraft = {
  consumer_number: "",
  customer_name: "",
  provider: "",
  meter_number: "",
  billing_date: "",
  billing_period: "",
  due_date: "",
  previous_reading: null,
  current_reading: null,
  units_consumed: null,
  energy_charge: null,
  fixed_charge: null,
  tax: null,
  other_charge: null,
  total_amount: null,
  tariff: "",
  tariff_description: "",
  ocr_confidence: 0,
};

export function draftFromRecord(record: BillRecord): BillDraft {
  const {
    id: _id,
    session_id: _session,
    source_file_path: _path,
    created_at: _created,
    updated_at: _updated,
    ...draft
  } = record;
  return draft;
}
