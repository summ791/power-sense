import { emptyBillDraft, type BillDraft } from "../types";
import { safeNumber } from "./calculations";

function cleaned(value: string) {
  return value.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
}
function afterLabel(text: string, labels: string[]) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:#-]?\\s*([^\\n]{2,50})`, "i");
  return text.match(pattern)?.[1]?.trim() ?? "";
}
function numericAfterLabel(text: string, labels: string[]) {
  const value = afterLabel(text, labels);
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  return match ? safeNumber(match[0]) : null;
}
function dateAfterLabel(text: string, labels: string[]) {
  const value = afterLabel(text, labels);
  const match = value.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/);
  if (!match) return "";
  const parts = match[1].split(/[/-]/).map(Number);
  const date = parts[0] > 31 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(parts[2] < 100 ? 2000 + parts[2] : parts[2], parts[1] - 1, parts[0]);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10);
}

export function parseElectricityBill(rawText: string, ocrConfidence = 0.6): BillDraft {
  const text = cleaned(rawText);
  const providerMatch = text.match(/\b(BESCOM|MSEDCL|TNEB|WBSEDCL|KSEB|UPPCL|TSSPDCL|APSPDCL|DHBVN|UHBVN|TATA POWER|ADANI ELECTRICITY|BSES|JVVNL|CESU|ELECTRICITY BOARD|ELECTRICITY DEPARTMENT)\b/i);
  const provider = providerMatch?.[1] ?? afterLabel(text, ["provider", "discom", "utility", "electricity board"]);
  const consumer = afterLabel(text, ["consumer (?:no|number|id)", "account (?:no|number)", "service no", "rr number", "ca number"]);
  const name = afterLabel(text, ["customer name", "consumer name", "name of consumer", "name"]);
  const meter = afterLabel(text, ["meter (?:no|number|serial)", "meter id"]);
  const billingDate = dateAfterLabel(text, ["bill date", "billing date", "issue date", "date of bill"]);
  const dueDate = dateAfterLabel(text, ["due date", "last date"]);
  const previous = numericAfterLabel(text, ["previous reading", "prev reading", "opening reading", "previous meter reading"]);
  const current = numericAfterLabel(text, ["current reading", "present reading", "closing reading", "current meter reading"]);
  const printedUnits = numericAfterLabel(text, ["units consumed", "units", "consumption", "energy consumption", "kwh"]);
  const energy = numericAfterLabel(text, ["energy charge", "energy charges", "variable charge"]);
  const fixed = numericAfterLabel(text, ["fixed charge", "fixed charges", "meter charge"]);
  const tax = numericAfterLabel(text, ["tax", "gst", "electricity duty"]);
  const other = numericAfterLabel(text, ["other charges", "arrears", "adjustment", "rebate"]);
  const total = numericAfterLabel(text, ["total amount", "amount payable", "net payable", "bill amount", "total bill"]);
  const calculated = previous !== null && current !== null && current >= previous ? current - previous : null;
  const likelyUnits = calculated ?? printedUnits;
  const period = afterLabel(text, ["billing period", "bill period", "reading period", "cycle"]);
  const tariff = afterLabel(text, ["tariff", "category", "sanctioned load", "slab"]);
  const found = [consumer, name, provider, meter, billingDate, dueDate, previous, current, printedUnits, energy, fixed, tax, other, total].filter((value) => value !== "" && value !== null).length;
  return {
    ...emptyBillDraft,
    consumer_number: cleaned(consumer),
    customer_name: cleaned(name),
    provider: cleaned(provider),
    meter_number: cleaned(meter),
    billing_date: billingDate,
    billing_period: cleaned(period),
    due_date: dueDate,
    previous_reading: previous,
    current_reading: current,
    units_consumed: likelyUnits,
    energy_charge: energy,
    fixed_charge: fixed,
    tax,
    other_charge: other,
    total_amount: total,
    tariff: cleaned(tariff),
    ocr_confidence: Math.min(0.99, Math.max(0.1, ocrConfidence * (0.65 + found / 40))),
  };
}

export function verifyDraft(draft: BillDraft) {
  const calculated = draft.previous_reading !== null && draft.current_reading !== null ? draft.current_reading - draft.previous_reading : null;
  const negative = calculated !== null && calculated < 0;
  const mismatch = calculated !== null && draft.units_consumed !== null && Math.abs(calculated - draft.units_consumed) > 1;
  const missing = [draft.billing_date, draft.units_consumed, draft.total_amount].filter((value) => value === null || value === "").length;
  return { calculated, negative, mismatch, missing };
}
