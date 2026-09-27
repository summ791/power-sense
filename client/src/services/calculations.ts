import type { BillRecord } from "../types";

export function safeNumber(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculatedUnits(
  previous: number | null,
  current: number | null
): number | null {
  if (previous === null || current === null) return null;
  const units = current - previous;
  return units >= 0 ? units : null;
}

export function percentageChange(
  current: number | null,
  previous: number | null
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function average(values: Array<number | null>): number | null {
  const numbers = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : null;
}

export function sortedBills(bills: BillRecord[]): BillRecord[] {
  return [...bills].sort((a, b) => {
    const aDate =
      Date.parse(a.billing_date || a.created_at) || Date.parse(a.created_at);
    const bDate =
      Date.parse(b.billing_date || b.created_at) || Date.parse(b.created_at);
    return aDate - bDate;
  });
}

export function billUnits(bill: BillRecord): number | null {
  return (
    bill.units_consumed ??
    calculatedUnits(bill.previous_reading, bill.current_reading)
  );
}

export function billAmount(bill: BillRecord): number | null {
  if (bill.total_amount !== null) return bill.total_amount;
  const values = [
    bill.energy_charge,
    bill.fixed_charge,
    bill.tax,
    bill.other_charge,
  ];
  const known = values.filter(
    (value): value is number => typeof value === "number"
  );
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function monthlyKey(bill: BillRecord): string {
  const candidate = bill.billing_date || bill.billing_period;
  if (candidate) {
    const isoDate = candidate.match(/^(\d{4})-(\d{2})/);
    if (isoDate) return `${isoDate[1]}-${isoDate[2]}`;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.valueOf())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    }
  }
  if (bill.billing_period.trim())
    return `period:${bill.billing_period.trim().toLowerCase()}`;
  return `record:${bill.id}`;
}

export function chartRows(bills: BillRecord[]) {
  const grouped = new Map<
    string,
    { period: string; units: number | null; amount: number | null }
  >();
  for (const bill of sortedBills(bills)) {
    const key = monthlyKey(bill);
    const existing = grouped.get(key) ?? {
      period: formatPeriod(
        bill.billing_period || bill.billing_date || bill.created_at
      ),
      units: null,
      amount: null,
    };
    const units = billUnits(bill);
    const amount = billAmount(bill);
    if (units !== null) existing.units = (existing.units ?? 0) + units;
    if (amount !== null) existing.amount = (existing.amount ?? 0) + amount;
    grouped.set(key, existing);
  }
  const rows: Array<{
    key: string;
    period: string;
    units: number | null;
    amount: number | null;
  }> = [];
  grouped.forEach((row, key) => rows.push({ key, ...row }));
  return rows
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key: _key, ...row }) => row);
}

export function analytics(bills: BillRecord[]) {
  const ordered = chartRows(bills);
  const units = ordered.map(row => row.units);
  const current = units.at(-1) ?? null;
  const previous = units.at(-2) ?? null;
  const all = units.filter((value): value is number => value !== null);
  return {
    current,
    previous,
    difference:
      current !== null && previous !== null ? current - previous : null,
    change: percentageChange(current, previous),
    average: average(units),
    threeMonthAverage: average(units.slice(-3)),
    sixMonthAverage: average(units.slice(-6)),
    highest: all.length ? Math.max(...all) : null,
    lowest: all.length ? Math.min(...all) : null,
    totalBills: bills.length,
  };
}

export function formatPeriod(value: string): string {
  if (!value) return "Unspecified";
  const date = new Date(value);
  if (!Number.isNaN(date.valueOf()) && value.length >= 8) {
    return date.toLocaleDateString("en-IN", {
      timeZone: "UTC",
      month: "short",
      year: "2-digit",
    });
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 14 ? `${cleaned.slice(0, 13)}…` : cleaned;
}

export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(
  value: number | null | undefined,
  fractionDigits = 0
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}
