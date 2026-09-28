import { emptyBillDraft, type BillDraft } from "../types";
import { safeNumber } from "./calculations";

function cleaned(value: string) {
  return value
    .replace(/[|]/g, " ")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function afterLabel(text: string, labels: string[]) {
  const pattern = new RegExp(
    `(?:${labels.join("|")})\\s*[:#-]?\\s*([^\\n]{0,70})(?:\\n([^\\n]{1,70}))?`,
    "i"
  );
  const match = text.match(pattern);
  return match?.[1]?.trim() || match?.[2]?.trim() || "";
}

function explicitAfterLabel(text: string, labels: string[]) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:#]\\s*([^\\n]{0,70})`,
    "im"
  );
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function numericAfterLabel(text: string, labels: string[]) {
  // Prefer a number on the same OCR line as the specific label. This avoids reading adjacent table columns as one large consumption value.
  for (const line of text.split(/\r?\n/)) {
    for (const label of labels) {
      const sameLine = line.match(new RegExp(`(?:${label})\\s*[:#-]?\\s*(.*)import { emptyBillDraft, type BillDraft } from "../types";
import { safeNumber } from "./calculations";

function cleaned(value: string) {
  return value
    .replace(/[|]/g, " ")
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function afterLabel(text: string, labels: string[]) {
  const pattern = new RegExp(
    `(?:${labels.join("|")})\\s*[:#-]?\\s*([^\\n]{0,70})(?:\\n([^\\n]{1,70}))?`,
    "i"
  );
  const match = text.match(pattern);
  return match?.[1]?.trim() || match?.[2]?.trim() || "";
}

function explicitAfterLabel(text: string, labels: string[]) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:#]\\s*([^\\n]{0,70})`,
    "im"
  );
  return text.match(pattern)?.[1]?.trim() ?? "";
}

, "i"));
      const number = sameLine?.[1]?.match(/-?\\d[\\d,]*(?:\\.\\d+)?/);
      if (number) return safeNumber(number[0]);
    }
  }
  const value = afterLabel(text, labels);
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (match) return safeNumber(match[0]);
  const marker = text.search(
    new RegExp(`(?:${labels.join("|")})\\s*[:#-]?`, "i")
  );
  if (marker < 0) return null;
  const nearby = text.slice(marker, marker + 180).match(/-?\d[\d,]*(?:\.\d+)?/);
  return nearby ? safeNumber(nearby[0]) : null;
}

function dateAfterLabel(text: string, labels: string[]) {
  const value = afterLabel(text, labels);
  const match = value.match(
    /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/
  );
  if (!match) return "";

  let year: number;
  let month: number;
  let day: number;
  const token = match[1];
  if (/^[A-Za-z]/.test(token)) return "";
  if (/\d{4}[/-]/.test(token)) {
    [year, month, day] = token.split(/[/-]/).map(Number);
  } else if (/\d{1,2}\s+[A-Za-z]/.test(token)) {
    const parsed = new Date(`${token} UTC`);
    if (Number.isNaN(parsed.valueOf())) return "";
    year = parsed.getUTCFullYear();
    month = parsed.getUTCMonth() + 1;
    day = parsed.getUTCDate();
  } else {
    const [dayPart, monthPart, yearPart] = token.split(/[/-]/).map(Number);
    year = yearPart < 100 ? 2000 + yearPart : yearPart;
    month = monthPart;
    day = dayPart;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "";
  return date.toISOString().slice(0, 10);
}

function explicitTamilNaduCategory(
  provider: string,
  tariffText: string
): string {
  const text = `${provider} ${tariffText}`;
  const tamilNadu =
    /\b(tneb|tangedco|tamil\s+nadu|lt\s*[- ]?ia|lt\s*[- ]?v)\b/i.test(text);
  if (!tamilNadu) return "";
  if (/commercial|general\s+purpose|\blt\s*[- ]?v\b/i.test(text))
    return "commercial";
  if (/residential|domestic|\blt\s*[- ]?ia\b/i.test(text)) return "residential";
  return "";
}

export function parseElectricityBill(
  rawText: string,
  ocrConfidence = 0.6
): BillDraft {
  const text = cleaned(rawText);
  const providerMatch = text.match(
    /\b(BESCOM|MSEDCL|TNEB|TANGEDCO|WBSEDCL|KSEB|UPPCL|TSSPDCL|APSPDCL|DHBVN|UHBVN|TATA POWER|ADANI ELECTRICITY|BSES|JVVNL|CESU|ELECTRICITY BOARD|ELECTRICITY DEPARTMENT)\b/i
  );
  const provider =
    providerMatch?.[1] ??
    explicitAfterLabel(text, [
      "electricity\\s+provider",
      "provider\\s+name",
      "provider",
      "discom",
      "utility(?:\\s+name)?",
      "electricity\\s+board",
    ]);
  const consumer = afterLabel(text, [
    "consumer (?:no|number|id)",
    "customer (?:no|number|id)",
    "account (?:no|number)",
    "service (?:no|number)",
    "rr number",
    "ca number",
  ]);
  const name = afterLabel(text, [
    "customer name",
    "consumer name",
    "name of consumer",
    "name",
  ]);
  const meter = afterLabel(text, ["meter (?:no|number|serial)", "meter id"]);
  const billingDate = dateAfterLabel(text, [
    "bill date",
    "billing date",
    "issue date",
    "date of bill",
  ]);
  const dueDate = dateAfterLabel(text, ["due date", "last date", "pay by"]);
  const previous = numericAfterLabel(text, [
    "previous reading",
    "prev reading",
    "opening reading",
    "previous meter reading",
  ]);
  const current = numericAfterLabel(text, [
    "current reading",
    "present reading",
    "closing reading",
    "current meter reading",
  ]);
  const printedUnits = numericAfterLabel(text, [
    "units consumed",
    "energy consumption",
    "consumption",
    "units",
    "kwh",
  ]);
  const energy = numericAfterLabel(text, [
    "energy charge",
    "energy charges",
    "electricity charge",
    "variable charge",
  ]);
  const fixed = numericAfterLabel(text, [
    "fixed charge",
    "fixed charges",
    "meter charge",
  ]);
  const tax = numericAfterLabel(text, ["tax", "gst", "electricity duty"]);
  const other = numericAfterLabel(text, [
    "other charges",
    "arrears",
    "adjustment",
    "rebate",
  ]);
  const total = numericAfterLabel(text, [
    "total amount",
    "amount payable",
    "net payable",
    "bill amount",
    "total bill",
    "grand total",
  ]);
  const calculated =
    previous !== null && current !== null && current >= previous
      ? current - previous
      : null;
  const likelyUnits = calculated ?? printedUnits;
  const period = afterLabel(text, [
    "billing period",
    "bill period",
    "reading period",
    "billing cycle",
    "cycle",
  ]);
  const tariffDescription = afterLabel(text, [
    "tariff category",
    "tariff details",
    "tariff",
    "category",
    "slab",
  ]);
  const found = [
    consumer,
    name,
    provider,
    meter,
    billingDate,
    dueDate,
    previous,
    current,
    printedUnits,
    energy,
    fixed,
    tax,
    other,
    total,
  ].filter(value => value !== "" && value !== null).length;

  return {
    ...emptyBillDraft,
    consumer_number: cleaned(consumer).split("\n")[0] ?? "",
    customer_name: cleaned(name).split("\n")[0] ?? "",
    provider: cleaned(provider).split("\n")[0] ?? "",
    meter_number: cleaned(meter).split("\n")[0] ?? "",
    billing_date: billingDate,
    billing_period: cleaned(period).split("\n")[0] ?? "",
    due_date: dueDate,
    previous_reading: previous,
    current_reading: current,
    units_consumed: likelyUnits,
    energy_charge: energy,
    fixed_charge: fixed,
    tax,
    other_charge: other,
    total_amount: total,
    tariff: explicitTamilNaduCategory(provider, tariffDescription),
    tariff_description: cleaned(tariffDescription).split("\n")[0] ?? "",
    ocr_confidence: Math.min(
      0.99,
      Math.max(0.1, ocrConfidence * (0.65 + found / 40))
    ),
  };
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function verifyDraft(draft: BillDraft) {
  const calculated =
    draft.previous_reading !== null && draft.current_reading !== null
      ? draft.current_reading - draft.previous_reading
      : null;
  const negative =
    (calculated !== null && calculated < 0) ||
    [
      draft.previous_reading,
      draft.current_reading,
      draft.units_consumed,
      draft.energy_charge,
      draft.fixed_charge,
      draft.tax,
      draft.total_amount,
    ].some(value => value !== null && value < 0);
  const impossibleReading = [
    draft.previous_reading,
    draft.current_reading,
  ].some(value => value !== null && value > 1_000_000_000);
  const mismatch =
    calculated !== null &&
    draft.units_consumed !== null &&
    Math.abs(calculated - draft.units_consumed) > 1;
  const invalidDate =
    Boolean(draft.billing_date && !validIsoDate(draft.billing_date)) ||
    Boolean(draft.due_date && !validIsoDate(draft.due_date));
  const missing = [
    draft.billing_date,
    draft.units_consumed,
    draft.total_amount,
  ].filter(value => value === null || value === "").length;
  const missingFields = [
    !draft.consumer_number && "consumer number",
    !draft.provider && "electricity provider",
    !draft.billing_date && "billing date",
    !draft.billing_period && "billing period",
    draft.units_consumed === null && "units consumed",
    draft.total_amount === null && "total amount",
  ].filter((value): value is string => Boolean(value));
  const charges = [
    draft.energy_charge,
    draft.fixed_charge,
    draft.tax,
    draft.other_charge,
  ].filter((value): value is number => value !== null);
  const knownChargeTotal = charges.length
    ? charges.reduce((sum, value) => sum + value, 0)
    : null;
  const inconsistentCharges =
    knownChargeTotal !== null &&
    draft.total_amount !== null &&
    Math.abs(knownChargeTotal - draft.total_amount) >
      Math.max(5, draft.total_amount * 0.05);
  return {
    calculated,
    negative,
    impossibleReading,
    mismatch,
    invalidDate,
    missing,
    missingFields,
    inconsistentCharges,
  };
}
