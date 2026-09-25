export type TariffSlab = { upto: number | null; rate: number };
export type TariffConfig = { slabs: TariffSlab[]; fixedCharge: number; taxRate: number; otherCharge: number };
export type TamilNaduCategory = "residential" | "commercial";
export type TamilNaduBillingCycle = "monthly" | "bi-monthly";

export const TAMIL_NADU_TARIFF_EFFECTIVE_DATE = "2025-07-01";
export const TAMIL_NADU_TARIFF_SOURCE = "https://tnerc.tn.gov.in/Orders/files/TO-Order%20No6300620252131.pdf";
export const TAMIL_NADU_TARIFF_OPTIONS = [
  { value: "residential", label: "Tamil Nadu · Residential / Domestic (LT-IA)" },
  { value: "commercial", label: "Tamil Nadu · Commercial / General purpose (LT-V)" },
] as const;

/** Retained as a generic fallback for records from older versions of Power Sense. */
export const defaultTariff: TariffConfig = {
  slabs: [
    { upto: 100, rate: 3.5 },
    { upto: 200, rate: 5 },
    { upto: 400, rate: 6.5 },
    { upto: null, rate: 7.5 },
  ],
  fixedCharge: 120,
  taxRate: 0.05,
  otherCharge: 0,
};

export type BillEstimate = { energy: number; fixed: number; tax: number; other: number; total: number; tariffLabel: string; note: string };

export function estimateBill(units: number, config: TariffConfig = defaultTariff) {
  const safeUnits = Math.max(0, Math.round(units));
  let remaining = safeUnits;
  let consumedBefore = 0;
  let energy = 0;
  for (const slab of config.slabs) {
    if (remaining <= 0) break;
    const capacity = slab.upto === null ? remaining : Math.max(0, slab.upto - consumedBefore);
    const inSlab = Math.min(remaining, capacity);
    energy += inSlab * slab.rate;
    remaining -= inSlab;
    consumedBefore += inSlab;
  }
  const tax = (energy + config.fixedCharge + config.otherCharge) * config.taxRate;
  const total = energy + config.fixedCharge + config.otherCharge + tax;
  return { energy, fixed: config.fixedCharge, tax, other: config.otherCharge, total };
}

function domesticSlabs(cycle: TamilNaduBillingCycle): TariffSlab[] {
  return cycle === "bi-monthly"
    ? [{ upto: 400, rate: 4.95 }, { upto: 500, rate: 6.65 }, { upto: 600, rate: 8.8 }, { upto: 800, rate: 9.95 }, { upto: 1000, rate: 11.05 }, { upto: null, rate: 12.15 }]
    : [{ upto: 200, rate: 4.95 }, { upto: 250, rate: 6.65 }, { upto: 300, rate: 8.8 }, { upto: 400, rate: 9.95 }, { upto: 500, rate: 11.05 }, { upto: null, rate: 12.15 }];
}

function progressiveEnergy(units: number, slabs: TariffSlab[]) {
  let remaining = Math.max(0, Math.round(units));
  let consumedBefore = 0;
  let energy = 0;
  for (const slab of slabs) {
    if (remaining <= 0) break;
    const capacity = slab.upto === null ? remaining : Math.max(0, slab.upto - consumedBefore);
    const inSlab = Math.min(remaining, capacity);
    energy += inSlab * slab.rate;
    remaining -= inSlab;
    consumedBefore += inSlab;
  }
  return energy;
}

export function normaliseTamilNaduCategory(value?: string): TamilNaduCategory {
  const text = (value ?? "").toLowerCase();
  return /commercial|general purpose|tariff v|lt[- ]?v|shop|office|business/.test(text) ? "commercial" : "residential";
}

export function estimateTamilNaduBill(
  units: number,
  category: TamilNaduCategory = "residential",
  options: { billingCycle?: TamilNaduBillingCycle; connectedLoadKw?: number } = {},
): BillEstimate {
  const cycle = options.billingCycle ?? "monthly";
  const safeUnits = Math.max(0, Math.round(units));
  if (category === "commercial") {
    const monthlyUnits = cycle === "bi-monthly" ? safeUnits / 2 : safeUnits;
    const energyRate = monthlyUnits <= 50 ? 6.65 : 10.45;
    const connectedLoadKw = Math.max(0, options.connectedLoadKw ?? 3);
    const fixed = 110 * connectedLoadKw * (cycle === "bi-monthly" ? 2 : 1);
    const energy = safeUnits * energyRate;
    return {
      energy,
      fixed,
      tax: 0,
      other: 0,
      total: energy + fixed,
      tariffLabel: "Tamil Nadu LT-V commercial / general purpose",
      note: `LT-V FY 2025-26 rate: ₹${energyRate.toFixed(2)}/unit for all consumption at this threshold; fixed charge assumes ${connectedLoadKw} kW at ₹110/kW/month.`,
    };
  }
  const energy = progressiveEnergy(safeUnits, domesticSlabs(cycle));
  return {
    energy,
    fixed: 0,
    tax: 0,
    other: 0,
    total: energy,
    tariffLabel: "Tamil Nadu LT-IA residential / domestic",
    note: `LT-IA FY 2025-26 progressive slab estimate for ${cycle} billing; fixed charge is nil in the commission-determined domestic schedule.`,
  };
}

export function estimateRange(units: number, spread = Math.max(12, units * 0.06)) {
  return { low: Math.max(0, Math.round(units - spread)), high: Math.max(0, Math.round(units + spread)) };
}

export function tariffCategoryLabel(value?: string) {
  return normaliseTamilNaduCategory(value) === "commercial" ? TAMIL_NADU_TARIFF_OPTIONS[1].label : TAMIL_NADU_TARIFF_OPTIONS[0].label;
}
