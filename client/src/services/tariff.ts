export type TariffSlab = { upto: number | null; rate: number };
export type TariffConfig = { slabs: TariffSlab[]; fixedCharge: number; taxRate: number; otherCharge: number };

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

export function estimateRange(units: number, spread = Math.max(12, units * 0.06)) {
  return { low: Math.max(0, Math.round(units - spread)), high: Math.max(0, Math.round(units + spread)) };
}
