export type TariffSlab = { upto: number | null; rate: number };
export type TariffConfig = {
  slabs: TariffSlab[];
  fixedCharge: number;
  taxRate: number;
  otherCharge: number;
};
export type TamilNaduCategory = "residential" | "commercial";
export type TamilNaduBillingCycle = "monthly" | "bi-monthly";

/** Latest tariff rate table posted by TNPDCL at the time of this update. */
export const TAMIL_NADU_TARIFF_EFFECTIVE_DATE = "2025-07-01";
/** G.O. Ms. No. 50 / TNERC Order No. 5 of 2026 subsidy effective date. */
export const TAMIL_NADU_SUBSIDY_EFFECTIVE_DATE = "2026-05-10";
export const TAMIL_NADU_TARIFF_SOURCE =
  "https://tnerc.tn.gov.in/Orders/files/TO-Order%20No6300620252131.pdf";
export const TAMIL_NADU_TARIFF_SCHEDULE_SOURCE =
  "https://www.tnpdcl.org/en/tnpdcl/billing-services/schedules-tariff/";
export const TAMIL_NADU_SUBSIDY_SOURCE =
  "https://tnerc.tn.gov.in/TariffOrders.aspx";
export const TAMIL_NADU_TAX_SOURCE =
  "https://tnei.tn.gov.in/pages/display/6-about-us";
export const TAMIL_NADU_TARIFF_OPTIONS = [
  {
    value: "residential",
    label: "Tamil Nadu · Residential / Domestic (LT-IA)",
  },
  {
    value: "commercial",
    label: "Tamil Nadu · Commercial / General purpose (LT-V)",
  },
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

export type BillEstimate = {
  energy: number;
  fixed: number;
  tax: number;
  other: number;
  total: number;
  tariffLabel: string;
  note: string;
};

export function estimateBill(
  units: number,
  config: TariffConfig = defaultTariff
) {
  const safeUnits = Math.max(0, Math.round(units));
  let remaining = safeUnits;
  let consumedBefore = 0;
  let energy = 0;
  for (const slab of config.slabs) {
    if (remaining <= 0) break;
    const capacity =
      slab.upto === null ? remaining : Math.max(0, slab.upto - consumedBefore);
    const inSlab = Math.min(remaining, capacity);
    energy += inSlab * slab.rate;
    remaining -= inSlab;
    consumedBefore += inSlab;
  }
  const tax =
    (energy + config.fixedCharge + config.otherCharge) * config.taxRate;
  const total = energy + config.fixedCharge + config.otherCharge + tax;
  return {
    energy,
    fixed: config.fixedCharge,
    tax,
    other: config.otherCharge,
    total,
  };
}

const domesticPayableSlabs: Record<TamilNaduBillingCycle, TariffSlab[]> = {
  "bi-monthly": [
    { upto: 400, rate: 4.7 },
    { upto: 500, rate: 6.3 },
    { upto: 600, rate: 8.4 },
    { upto: 800, rate: 9.45 },
    { upto: 1000, rate: 10.5 },
    { upto: null, rate: 11.55 },
  ],
  monthly: [
    { upto: 200, rate: 4.7 },
    { upto: 250, rate: 6.3 },
    { upto: 300, rate: 8.4 },
    { upto: 400, rate: 9.45 },
    { upto: 500, rate: 10.5 },
    { upto: null, rate: 11.55 },
  ],
};

function safeRoundedUnits(units: number) {
  return Number.isFinite(units) ? Math.max(0, Math.round(units)) : 0;
}

function progressiveEnergyAfterFreeUnits(
  units: number,
  freeUnits: number,
  slabs: TariffSlab[]
) {
  let energy = 0;
  let lowerBound = 0;
  for (const slab of slabs) {
    const upperBound = slab.upto ?? Number.POSITIVE_INFINITY;
    const billableStart = Math.max(lowerBound, freeUnits);
    const billableEnd = Math.min(units, upperBound);
    if (billableEnd > billableStart) {
      energy += (billableEnd - billableStart) * slab.rate;
    }
    lowerBound = upperBound;
  }
  return energy;
}

function makeUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function periodDates(period: string) {
  const dates: Array<{ index: number; value: Date }> = [];
  const patterns = [
    {
      regex: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g,
      parse: (match: RegExpExecArray) =>
        makeUtcDate(Number(match[1]), Number(match[2]), Number(match[3])),
    },
    {
      regex: /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/g,
      parse: (match: RegExpExecArray) =>
        makeUtcDate(Number(match[3]), Number(match[2]), Number(match[1])),
    },
  ];
  for (const { regex, parse } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(period)) !== null) {
      const value = parse(match);
      if (value) dates.push({ index: match.index ?? 0, value });
    }
  }
  return dates
    .sort((left, right) => left.index - right.index)
    .map(item => item.value);
}

/**
 * TNPDCL's bill calculator says to choose monthly when the billing cycle is
 * shorter than 35 days. Unlabelled periods default to the usual two-month cycle.
 */
export function inferTamilNaduBillingCycle(
  billingPeriod?: string
): TamilNaduBillingCycle {
  const period = (billingPeriod ?? "").trim().toLowerCase();
  if (!period) return "bi-monthly";
  if (/\bbi[-\s]?monthly\b|\b2\s*months?\b|\btwo\s*months?\b/.test(period)) {
    return "bi-monthly";
  }
  if (/\bmonthly\b|\bone\s*month\b/.test(period)) return "monthly";

  const daysMatch = period.match(/\b(\d{1,3})\s*(?:calendar\s*)?days?\b/);
  if (daysMatch) {
    return Number(daysMatch[1]) < 35 ? "monthly" : "bi-monthly";
  }

  const dates = periodDates(period);
  if (dates.length >= 2) {
    const days =
      Math.abs(dates[dates.length - 1].getTime() - dates[0].getTime()) /
        86_400_000 +
      1;
    return days < 35 ? "monthly" : "bi-monthly";
  }

  const months = [
    "january|jan",
    "february|feb",
    "march|mar",
    "april|apr",
    "may",
    "june|jun",
    "july|jul",
    "august|aug",
    "september|sep|sept",
    "october|oct",
    "november|nov",
    "december|dec",
  ].join("|");
  const monthYearPattern = new RegExp(
    `\\b(${months})\\.?\\s+(20\\d{2})\\b`,
    "gi"
  );
  const monthYears: string[] = [];
  let monthMatch: RegExpExecArray | null;
  while ((monthMatch = monthYearPattern.exec(period)) !== null) {
    monthYears.push(monthMatch[0]);
  }
  if (monthYears.length >= 2) {
    return monthYears[0].toLowerCase() === monthYears[1].toLowerCase()
      ? "monthly"
      : "bi-monthly";
  }
  return "bi-monthly";
}

export function normaliseTamilNaduCategory(value?: string): TamilNaduCategory {
  const text = (value ?? "").toLowerCase();
  return /commercial|general purpose|tariff v|lt[- ]?v|shop|office|business/.test(
    text
  )
    ? "commercial"
    : "residential";
}

function commercialFixedRatePerKw(connectedLoadKw: number) {
  if (connectedLoadKw <= 50) return 110;
  if (connectedLoadKw <= 112) return 332;
  return 608;
}

export function estimateTamilNaduBill(
  units: number,
  category: TamilNaduCategory = "residential",
  options: {
    billingCycle?: TamilNaduBillingCycle;
    connectedLoadKw?: number;
  } = {}
): BillEstimate {
  const cycle = options.billingCycle ?? "bi-monthly";
  const safeUnits = safeRoundedUnits(units);
  const periodsPerYear = cycle === "bi-monthly" ? 2 : 1;

  if (category === "commercial") {
    const lowRateThreshold = 50 * periodsPerYear;
    const subsidisedRateThreshold = 250 * periodsPerYear;
    const energyRate =
      safeUnits <= lowRateThreshold
        ? 6.45
        : safeUnits <= subsidisedRateThreshold
          ? 10.15
          : 10.45;
    const requestedLoad = options.connectedLoadKw ?? 3;
    const connectedLoadKw = Number.isFinite(requestedLoad)
      ? Math.max(0, requestedLoad)
      : 3;
    const fixed =
      commercialFixedRatePerKw(connectedLoadKw) *
      connectedLoadKw *
      periodsPerYear;
    const energy = safeUnits * energyRate;
    // Tamil Nadu's 5% electricity tax applies to commercial licensee supply;
    // domestic supply is explicitly exempt under the State's tax guidance.
    const tax = (energy + fixed) * 0.05;
    return {
      energy,
      fixed,
      tax,
      other: 0,
      total: energy + fixed + tax,
      tariffLabel: "Tamil Nadu LT-V commercial / general purpose",
      note: `LT-V latest posted consumer-payable rate: ₹${energyRate.toFixed(2)}/unit for all units at this cycle threshold; fixed charge assumes ${connectedLoadKw} kW at the published ₹${commercialFixedRatePerKw(connectedLoadKw)}/kW/month band; includes 5% electricity tax. No unpublished FY 2026-27 CPI adjustment is assumed.`,
    };
  }

  const eligibleThreshold = 250 * periodsPerYear;
  const freeUnits =
    safeUnits <= eligibleThreshold ? 100 * periodsPerYear : 50 * periodsPerYear;
  const energy = progressiveEnergyAfterFreeUnits(
    safeUnits,
    freeUnits,
    domesticPayableSlabs[cycle]
  );
  return {
    energy,
    fixed: 0,
    tax: 0,
    other: 0,
    total: energy,
    tariffLabel: "Tamil Nadu LT-IA residential / domestic",
    note: `LT-IA FY 2026-27 subsidy estimate for ${cycle} billing: ${freeUnits} free units at this usage threshold, then the latest posted consumer-payable progressive rates. Domestic supply is exempt from the State's 5% electricity tax. No unpublished FY 2026-27 CPI adjustment is assumed.`,
  };
}

export function estimateRange(
  units: number,
  spread = Math.max(12, units * 0.06)
) {
  return {
    low: Math.max(0, Math.round(units - spread)),
    high: Math.max(0, Math.round(units + spread)),
  };
}

export function tariffCategoryLabel(value?: string) {
  return normaliseTamilNaduCategory(value) === "commercial"
    ? TAMIL_NADU_TARIFF_OPTIONS[1].label
    : TAMIL_NADU_TARIFF_OPTIONS[0].label;
}
