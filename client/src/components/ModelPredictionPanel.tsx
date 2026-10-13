import { useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, Play, ShieldCheck } from "lucide-react";
import type { ModelFeatureInput, ModelPredictionResponse } from "../modelTypes";
import { requestModelPredictions } from "../services/modelApi";

const numericFields = [
  "Household_Size", "Number_of_Appliances", "Fan_Usage_Hours", "Fridge_Usage_Hours", "AC_Usage_Hours", "TV_Usage_Hours", "Monitor_Usage_Hours", "MotorPump_Usage_Hours", "Appliance_Usage_Hours", "Working_Hours", "Temperature", "Humidity", "Month", "Previous_Month_Units", "Current_Month_Units", "Peak_Usage", "Off_Peak_Usage", "Cost_Per_Unit", "Monthly_Bill", "Year", "Carbon_Footprint", "Usage_Efficiency", "Previous_Month_Bill", "Bill_Change", "Peak_Usage_Percent", "Yearly_Consumption_Estimate", "Savings_Potential_Score",
] as const;
const categoricalFields = [
  "Consumer_Type", "Consumer_Category", "Region", "City", "Building_Type", "Business_Type", "Weather", "Season", "Tariff_Category", "Billing_Cycle", "Payment_Status",
] as const;
const modelFields = [...numericFields, ...categoricalFields];

type DraftValues = Record<string, string>;

function emptyValues(): DraftValues {
  return Object.fromEntries(modelFields.map((field) => [field, ""]));
}

function parseFeatures(values: DraftValues): ModelFeatureInput {
  const missing = modelFields.filter((field) => !values[field].trim());
  if (missing.length) throw new Error(`Complete all model inputs before running: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}`);
  const result = {} as ModelFeatureInput;
  for (const field of numericFields) {
    const value = Number(values[field]);
    if (!Number.isFinite(value)) throw new Error(`${field} must be a number.`);
    (result as Record<string, unknown>)[field] = value;
  }
  for (const field of categoricalFields) (result as Record<string, unknown>)[field] = values[field].trim();
  return result;
}

export function ModelPredictionPanel() {
  const [values, setValues] = useState<DraftValues>(emptyValues);
  const [result, setResult] = useState<ModelPredictionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setField = (field: string, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const run = async () => {
    setBusy(true); setError(null);
    try { setResult(await requestModelPredictions(parseFeatures(values))); }
    catch (reason) { setResult(null); setError(reason instanceof Error ? reason.message : "The model service could not complete this prediction."); }
    finally { setBusy(false); }
  };
  return <section className="panel mt-6" aria-labelledby="ai-model-heading">
    <div className="panel-kicker">SUPPLIED AI MODELS · ON-DEMAND API</div>
    <div className="panel-heading"><div><h2 id="ai-model-heading">Run the trained model pair</h2><p className="panel-intro">The units model and bill model remain separate. Enter the original training columns; no missing household or appliance values are invented.</p></div><BrainCircuit size={22} /></div>
    <details className="model-inputs-details"><summary>Enter model inputs ({modelFields.length} required fields)</summary><div className="model-input-grid mt-4">{modelFields.map((field) => <label className="field" key={field}><span>{field}</span><input value={values[field]} inputMode={numericFields.includes(field as typeof numericFields[number]) ? "decimal" : "text"} onChange={(event) => setField(field, event.target.value)} placeholder={numericFields.includes(field as typeof numericFields[number]) ? "Number" : "Text from training categories"} /></label>)}</div><button className="button button-primary mt-5" onClick={run} disabled={busy}>{busy ? "Running both models…" : "Run both AI models"}<Play size={15} /></button></details>
    {error && <div className="warning-box error mt-4"><AlertTriangle size={17} /><div><strong>Prediction not completed</strong><span>{error}</span></div></div>}
    {result && <div className="model-results mt-5"><div className="model-result-card"><span>Units prediction · GradientBoostingRegressor</span><strong>{result.models.units ? `${result.models.units.predicted_kwh.toFixed(1)} kWh` : "Not requested"}</strong></div><div className="model-result-card"><span>Bill prediction · CatBoostRegressor</span><strong>{result.models.bill ? `₹${result.models.bill.predicted_amount.toFixed(2)}` : "Not requested"}</strong></div><div className="small-note"><ShieldCheck size={15} /><span>{result.subsidy.rule} Payable units after subsidy: <strong>{result.subsidy.payable_units}</strong>. Model service available until {result.expires_on}.</span></div><div className="small-note"><CheckCircle2 size={15} /><span>The deterministic Tamil Nadu tariff estimate remains separate from the bill model output; neither result silently overwrites the other.</span></div></div>}
  </section>;
}
