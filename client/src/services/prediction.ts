import type { BillRecord, PredictionResult } from "../types";
import { average, billUnits, sortedBills } from "./calculations";
import { estimateRange, estimateTamilNaduBill, normaliseTamilNaduCategory, tariffCategoryLabel } from "./tariff";

function linearForecast(values: number[]): number {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  return Math.max(0, meanY + slope * n);
}

function errors(values: number[], forecast: (history: number[]) => number) {
  if (values.length < 3) return { mae: null, mape: null };
  const actual: number[] = [];
  const predicted: number[] = [];
  for (let i = 2; i < values.length; i++) {
    const history = values.slice(0, i);
    actual.push(values[i]);
    predicted.push(forecast(history));
  }
  const absolute = actual.map((value, index) => Math.abs(value - predicted[index]));
  const validPercent = actual.map((value, index) => (value ? (Math.abs(value - predicted[index]) / value) * 100 : null)).filter((value): value is number => value !== null);
  return {
    mae: average(absolute),
    mape: average(validPercent),
  };
}

export function predictNextMonth(bills: BillRecord[]): PredictionResult {
  const values = sortedBills(bills).map(billUnits).filter((value): value is number => value !== null && value >= 0);
  if (values.length < 2) {
    return { predictedUnits: null, rangeLow: null, rangeHigh: null, predictedBillLow: null, predictedBillHigh: null, method: "Insufficient history", basis: "At least 2 verified bills are needed", mae: null, mape: null, message: "More historical data is required before a meaningful estimate can be calculated." };
  }
  let forecast: (history: number[]) => number;
  let method: string;
  if (values.length < 4) {
    forecast = (history) => history.reduce((sum, value, index) => sum + value * (index + 1), 0) / history.reduce((sum, _value, index) => sum + index + 1, 0);
    method = "Weighted average of available months";
  } else {
    forecast = linearForecast;
    method = "Least-squares trend regression over recorded months";
  }
  const predictedUnits = Math.round(forecast(values));
  const range = estimateRange(predictedUnits, Math.max(12, (Math.max(...values) - Math.min(...values)) * 0.3));
  const category = normaliseTamilNaduCategory(sortedBills(bills).at(-1)?.tariff);
  const lowBill = estimateTamilNaduBill(range.low, category).total;
  const highBill = estimateTamilNaduBill(range.high, category).total;
  const validation = errors(values, forecast);
  return {
    predictedUnits,
    rangeLow: range.low,
    rangeHigh: range.high,
    predictedBillLow: Math.round(lowBill),
    predictedBillHigh: Math.round(highBill),
    method,
    basis: `Previous ${Math.min(values.length, 6)} recorded months of electricity consumption · ${tariffCategoryLabel(category)}`,
    mae: validation.mae,
    mape: validation.mape,
  };
}
