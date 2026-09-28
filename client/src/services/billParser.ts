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

const NUMERIC_FIELD_LABELS = {
  previous: [
    "previous\\s+(?:meter\\s+)?reading",
    "prev\\.?\\s+(?:meter\\s+)?reading",
    "opening\\s+reading",
  ],
  current: [
    "current\\s+(?:meter\\s+)?reading",
    "present\\s+(?:meter\\s+)?reading",
    "closing\\s+reading",
  ],
  units: [
    "units\\s+consumed",
    "consumed\\s+units",
    "energy\\s+consumption",
    "consumption\\s*\\(\\s*(?:units|kwh)\\s*\\)",
    "consumption\\s+units",
    "kwh\\s+consumed",
  ],
  energy: [
    "energy\\s+charges?",
    "electricity\\s+charges?",
    "variable\\s+charges?",
  ],
  fixed: ["fixed\\s+charges?", "meter\\s+charges?"],
  tax: [
    "electricity\\s+duty(?:\\s*\\/\\s*tax)?",
    "duty\\s+charges?",
    "tax(?:es)?",
    "gst",
  ],
  other: [
    "other\\s+charges?",
    "misc(?:ellaneous)?\\s+charges?",
    "arrears",
    "adjustments?",
    "rebates?",
  ],
  total: [
    "total\\s+amount(?:\\s+(?:payable|due))?",
    "amount\\s+payable",
    "net\\s+payable",
    "total\\s+bill(?:\\s+amount)?",
    "bill\\s+amount",
    "grand\\s+total",
  ],
} as const;

type NumericField = keyof typeof NUMERIC_FIELD_LABELS;

const OTHER_FIELD_LABELS = [
  "consumer\\s+(?:no|number|id)",
  "customer\\s+(?:no|number|id)",
  "account\\s+(?:no|number)",
  "service\\s+(?:no|number)",
  "rr\\s+number",
  "ca\\s+number",
  "customer\\s+name",
  "consumer\\s+name",
  "name\\s+of\\s+consumer",
  "meter\\s+(?:no|number|serial)",
  "meter\\s+id",
  "bill\\s+date",
  "billing\\s+date",
  "issue\\s+date",
  "date\\s+of\\s+bill",
  "due\\s+date",
  "last\\s+date",
  "pay\\s+by",
  "billing\\s+period",
  "bill\\s+period",
  "reading\\s+period",
  "billing\\s+cycle",
  "tariff\\s+category",
  "tariff\\s+details",
  "tariff",
  "category",
  "slab",
  "electricity\\s+provider",
  "provider(?:\\s+name)?",
  "discom",
  "electricity\\s+board",
  "utility(?:\\s+name)?",
] as const;

type NumericLabelMatch = {
  field: NumericField | null;
  start: number;
  end: number;
};

type NumericToken = { value: number; start: number; end: number };

function numericLabelMatches(line: string): NumericLabelMatch[] {
  const candidates: NumericLabelMatch[] = [];
  const collect = (labels: readonly string[], field: NumericField | null) => {
    const alternatives = [...labels].sort((a, b) => b.length - a.length);
    const expression = new RegExp(
      `(^|[^A-Za-z0-9])(?:${alternatives.join("|")})(?=$|[^A-Za-z0-9])`,
      "gi"
    );
    let match: RegExpExecArray | null;
    while ((match = expression.exec(line)) !== null) {
      const prefixLength = match[1]?.length ?? 0;
      const start = (match.index ?? 0) + prefixLength;
      candidates.push({
        field,
        start,
        end: start + match[0].length - prefixLength,
      });
    }
  };

  for (const field of Object.keys(NUMERIC_FIELD_LABELS) as NumericField[]) {
    collect(NUMERIC_FIELD_LABELS[field], field);
  }
  collect(OTHER_FIELD_LABELS, null);

  candidates.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start)
  );
  const matches: NumericLabelMatch[] = [];
  for (const candidate of candidates) {
    if (
      matches.some(
        match => candidate.start < match.end && candidate.end > match.start
      )
    )
      continue;
    matches.push(candidate);
  }
  return matches.sort((a, b) => a.start - b.start);
}

function numericTokens(value: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  const expression = /-?\d[\d,]*(?:\.\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value)) !== null) {
    const number = safeNumber(match[0]);
    if (number === null) continue;
    const start = match.index ?? 0;
    tokens.push({ value: number, start, end: start + match[0].length });
  }
  return tokens;
}

function valueForField(tokens: NumericToken[], field: NumericField) {
  if (!tokens.length) return null;
  const amountFields: NumericField[] = [
    "energy",
    "fixed",
    "tax",
    "other",
    "total",
  ];
  const selected = amountFields.includes(field) ? tokens.at(-1) : tokens[0];
  return selected?.value ?? null;
}

function valueFromColumn(
  headers: NumericLabelMatch[],
  headerIndex: number,
  values: NumericToken[],
  field: NumericField
) {
  if (headerIndex < 0 || headerIndex >= headers.length || !values.length)
    return null;
  if (values.length === headers.length)
    return valueForField([values[headerIndex]], field);

  const center = (match: NumericLabelMatch) => (match.start + match.end) / 2;
  const target = center(headers[headerIndex]);
  const lower =
    headerIndex === 0
      ? Number.NEGATIVE_INFINITY
      : (center(headers[headerIndex - 1]) + target) / 2;
  const upper =
    headerIndex === headers.length - 1
      ? Number.POSITIVE_INFINITY
      : (target + center(headers[headerIndex + 1])) / 2;
  const inColumn = values.filter(token => {
    const tokenCenter = (token.start + token.end) / 2;
    return tokenCenter >= lower && tokenCenter < upper;
  });
  return inColumn.length === 1 ? valueForField(inColumn, field) : null;
}

function numericAfterLabel(text: string, field: NumericField) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter(line => line.trim());

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const labels = numericLabelMatches(line);
    const numericHeaders = labels.filter(
      (match): match is NumericLabelMatch & { field: NumericField } =>
        match.field !== null
    );
    for (const label of numericHeaders.filter(match => match.field === field)) {
      const nextLabel = labels.find(match => match.start >= label.end);
      const segment = line
        .slice(label.end, nextLabel?.start ?? line.length)
        .replace(/^\s*[:#-]\s*/, "");
      const directValue = valueForField(numericTokens(segment), field);
      if (directValue !== null) return directValue;

      const headerIndex = numericHeaders.indexOf(label);
      for (let offset = 1; offset <= 2; offset++) {
        const valueLine = lines[lineIndex + offset];
        if (!valueLine) break;
        if (numericLabelMatches(valueLine).length) break;
        const values = numericTokens(valueLine);
        if (!values.length) continue;
        const columnValue = valueFromColumn(
          numericHeaders,
          headerIndex,
          values,
          field
        );
        if (columnValue !== null) return columnValue;
        break;
      }
    }
  }
  return null;
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
  const layoutText = rawText.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const tamilNaduProvider = text.match(
    /\b(?:TAMIL\s+NADU\s+POWER\s+DISTRIBUTION\s+CORPORATION(?:\s+LIMITED)?|TNPDCL|TANGEDCO|TNEB|TAMIL\s+NADU\s+ELECTRICITY\s+BOARD)\b/i
  );
  const providerMatch = text.match(
    /\b(BESCOM|MSEDCL|TNEB|TANGEDCO|WBSEDCL|KSEB|UPPCL|TSSPDCL|APSPDCL|DHBVN|UHBVN|TATA POWER|ADANI ELECTRICITY|BSES|JVVNL|CESU|ELECTRICITY BOARD|ELECTRICITY DEPARTMENT)\b/i
  );
  const provider =
    (tamilNaduProvider
      ? "Tamil Nadu Power Distribution Corporation Limited"
      : providerMatch?.[1]) ??
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
  const previous = numericAfterLabel(layoutText, "previous");
  const current = numericAfterLabel(layoutText, "current");
  const printedUnits = numericAfterLabel(layoutText, "units");
  const energy = numericAfterLabel(layoutText, "energy");
  const fixed = numericAfterLabel(layoutText, "fixed");
  const tax = numericAfterLabel(layoutText, "tax");
  const other = numericAfterLabel(layoutText, "other");
  const total = numericAfterLabel(layoutText, "total");
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
    units_consumed: printedUnits,
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
