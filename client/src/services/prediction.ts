import type { BillRecord, PredictionResult } from "../types";
import { average, chartRows } from "./calculations";
import { estimateRange } from "./tariff";

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
  const absolute = actual.map((value, index) =>
    Math.abs(value - predicted[index])
  );
  const validPercent = actual
    .map((value, index) =>
      value ? (Math.abs(value - predicted[index]) / value) * 100 : null
    )
    .filter((value): value is number => value !== null);
  return { mae: average(absolute), mape: average(validPercent) };
}

function estimateHistoricalBill(
  rows: ReturnType<typeof chartRows>,
  lowUnits: number,
  highUnits: number
) {
  const points = rows
    .filter(
      (row): row is typeof row & { units: number; amount: number } =>
        row.units !== null &&
        row.units > 0 &&
        row.amount !== null &&
        row.amount >= 0
    )
    .slice(-6);
  if (points.length < 2) {
    return {
      predictedBillLow: null,
      predictedBillHigh: null,
      billMethod:
        "At least two saved bills with verified total amounts are needed; no tariff has been assumed.",
    };
  }

  const meanUnits =
    points.reduce((sum, point) => sum + point.units, 0) / points.length;
  const meanAmount =
    points.reduce((sum, point) => sum + point.amount, 0) / points.length;
  const denominator = points.reduce(
    (sum, point) => sum + (point.units - meanUnits) ** 2,
    0
  );
  const covariance = points.reduce(
    (sum, point) =>
      sum + (point.units - meanUnits) * (point.amount - meanAmount),
    0
  );
  let slope = denominator ? covariance / denominator : 0;
  let intercept = meanAmount - slope * meanUnits;
  if (
    !Number.isFinite(slope) ||
    slope <= 0 ||
    !Number.isFinite(intercept) ||
    intercept < 0
  ) {
    slope =
      points.reduce((sum, point) => sum + point.amount, 0) /
      points.reduce((sum, point) => sum + point.units, 0);
    intercept = 0;
  }

  const estimate = (units: number) =>
    Math.max(0, Math.round(intercept + slope * units));
  const amounts = [estimate(lowUnits), estimate(highUnits)].sort(
    (a, b) => a - b
  );
  return {
    predictedBillLow: amounts[0],
    predictedBillHigh: amounts[1],
    billMethod: `${points.length} recent monthly bill total${points.length === 1 ? "" : "s"} fitted against actual consumption; indicative only, not a tariff calculation.`,
  };
}

export function predictNextMonth(bills: BillRecord[]): PredictionResult {
  const rows = chartRows(bills);
  const values = rows
    .map(row => row.units)
    .filter((value): value is number => value !== null && value >= 0);
  if (values.length < 2) {
    return {
      predictedUnits: null,
      rangeLow: null,
      rangeHigh: null,
      predictedBillLow: null,
      predictedBillHigh: null,
      billMethod: "No tariff has been assumed.",
      method: "Insufficient history",
      basis: "At least 2 verified monthly readings are needed",
      mae: null,
      mape: null,
      message:
        "More historical data is required before a meaningful estimate can be calculated.",
    };
  }

  let forecast: (history: number[]) => number;
  let method: string;
  if (values.length < 4) {
    forecast = history =>
      history.reduce((sum, value, index) => sum + value * (index + 1), 0) /
      history.reduce((sum, _value, index) => sum + index + 1, 0);
    method = "Weighted average of available monthly readings";
  } else {
    forecast = linearForecast;
    method = "Least-squares trend regression over monthly readings";
  }

  const predictedUnits = Math.round(forecast(values));
  const spread = Math.max(
    12,
    (Math.max(...values) - Math.min(...values)) * 0.3
  );
  const range = estimateRange(predictedUnits, spread);
  const bill = estimateHistoricalBill(rows, range.low, range.high);
  const validation = errors(values, forecast);
  return {
    predictedUnits,
    rangeLow: range.low,
    rangeHigh: range.high,
    ...bill,
    method,
    basis: `Previous ${Math.min(values.length, 6)} saved month${values.length === 1 ? "" : "s"} of verified electricity consumption`,
    mae: validation.mae,
    mape: validation.mape,
  };
}
