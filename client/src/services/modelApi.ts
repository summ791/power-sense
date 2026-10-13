import type { ModelFeatureInput, ModelPredictionResponse } from "../modelTypes";

export async function requestModelPredictions(
  features: ModelFeatureInput,
  options: { models?: Array<"units" | "bill">; subsidyUnits?: number; tariffCategory?: string; billingCycle?: string } = {},
): Promise<ModelPredictionResponse> {
  const response = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      features,
      models: options.models ?? ["units", "bill"],
      subsidy_units: options.subsidyUnits,
      tariff_category: options.tariffCategory,
      billing_cycle: options.billingCycle,
    }),
  });
  const payload = (await response.json()) as ModelPredictionResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Model service returned HTTP ${response.status}.`);
  return payload;
}
