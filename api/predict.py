from __future__ import annotations

import json
import os
from datetime import date
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

import joblib
import pandas as pd


MODEL_EXPIRY = date(2026, 12, 31)
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
UNITS_MODEL_PATH = MODEL_DIR / "electricity_units_model.pkl"
BILL_MODEL_PATH = MODEL_DIR / "electricity_bill_model.pkl"

_NUMERIC_FEATURES = [
    "Household_Size", "Number_of_Appliances", "Fan_Usage_Hours", "Fridge_Usage_Hours", "AC_Usage_Hours", "TV_Usage_Hours", "Monitor_Usage_Hours", "MotorPump_Usage_Hours", "Appliance_Usage_Hours", "Working_Hours", "Temperature", "Humidity", "Month", "Previous_Month_Units", "Current_Month_Units", "Peak_Usage", "Off_Peak_Usage", "Cost_Per_Unit", "Monthly_Bill", "Year", "Carbon_Footprint", "Usage_Efficiency", "Previous_Month_Bill", "Bill_Change", "Peak_Usage_Percent", "Yearly_Consumption_Estimate", "Savings_Potential_Score",
]
_CATEGORICAL_FEATURES = [
    "Consumer_Type", "Consumer_Category", "Region", "City", "Building_Type", "Business_Type", "Weather", "Season", "Tariff_Category", "Billing_Cycle", "Payment_Status",
]
FEATURES = _NUMERIC_FEATURES + _CATEGORICAL_FEATURES

_units_bundle: dict[str, Any] | None = None
_bill_bundle: dict[str, Any] | None = None


def _load_bundle(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Model file is missing: {path.name}")
    bundle = joblib.load(path)
    if not isinstance(bundle, dict) or not {"preprocessor", "model"}.issubset(bundle):
        raise ValueError(f"Unexpected model bundle format: {path.name}")
    return bundle


def _units_bundle_cached() -> dict[str, Any]:
    global _units_bundle
    if _units_bundle is None:
        _units_bundle = _load_bundle(UNITS_MODEL_PATH)
    return _units_bundle


def _bill_bundle_cached() -> dict[str, Any]:
    global _bill_bundle
    if _bill_bundle is None:
        _bill_bundle = _load_bundle(BILL_MODEL_PATH)
    return _bill_bundle


def _validate_features(features: Any) -> pd.DataFrame:
    if not isinstance(features, dict):
        raise ValueError("features must be an object containing the model's original input columns")
    missing = [name for name in FEATURES if name not in features]
    if missing:
        raise ValueError(f"Missing model features: {', '.join(missing)}")
    row = {name: features[name] for name in FEATURES}
    for name in _NUMERIC_FEATURES:
        value = row[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Numeric feature {name} must be a number")
    for name in _CATEGORICAL_FEATURES:
        value = row[name]
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Categorical feature {name} must be a non-empty string")
    return pd.DataFrame([row], columns=FEATURES)


def _subsidy(units: Any, category: Any, billing_cycle: Any) -> dict[str, Any]:
    try:
        gross_units = max(0, int(round(float(units))))
    except (TypeError, ValueError):
        gross_units = 0
    is_domestic = str(category or "").strip().lower() in {"residential", "domestic", "lt-ia"}
    cycle = str(billing_cycle or "").strip().lower().replace("_", "-")
    is_bimonthly = cycle in {"bi-monthly", "bimonthly", "two-month", "two-monthly"}
    eligible = is_domestic and is_bimonthly
    free_units = 200 if eligible and gross_units <= 500 else 100 if eligible else 0
    return {
        "eligible": eligible,
        "billing_cycle": "bi-monthly" if is_bimonthly else "other",
        "gross_units": gross_units,
        "free_units": free_units,
        "payable_units": max(0, gross_units - free_units) if eligible else gross_units,
        "rule": "Domestic bi-monthly consumption <=500 units: 200 free units; above 500: 100 free units." if eligible else "No domestic bi-monthly subsidy applied.",
    }


def _prediction(bundle: dict[str, Any], frame: pd.DataFrame) -> float:
    transformed = bundle["preprocessor"].transform(frame)
    value = bundle["model"].predict(transformed)
    return float(value[0])


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", os.environ.get("MODEL_API_ALLOWED_ORIGIN", "*"))
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    def _reply(self, status: int, payload: dict[str, Any]) -> None:
        _json_response(self, status, payload)

    def do_OPTIONS(self) -> None:
        self._reply(204, {})

    def do_POST(self) -> None:
        if date.today() > MODEL_EXPIRY:
            self._reply(410, {"error": "Model service expired after 31 December 2026."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 100_000:
                raise ValueError("Request body must be between 1 byte and 100 KB")
            payload = json.loads(self.rfile.read(length))
            frame = _validate_features(payload.get("features"))
            requested = payload.get("models", ["units", "bill"])
            if not isinstance(requested, list) or not requested or any(name not in {"units", "bill"} for name in requested):
                raise ValueError("models must contain only 'units' and/or 'bill'")
            result: dict[str, Any] = {"expires_on": MODEL_EXPIRY.isoformat(), "models": {}}
            if "units" in requested:
                result["models"]["units"] = {"predicted_kwh": _prediction(_units_bundle_cached(), frame)}
            if "bill" in requested:
                result["models"]["bill"] = {"predicted_amount": _prediction(_bill_bundle_cached(), frame)}
            result["subsidy"] = _subsidy(payload.get("subsidy_units", frame.iloc[0]["Current_Month_Units"]), payload.get("tariff_category", frame.iloc[0]["Tariff_Category"]), payload.get("billing_cycle", frame.iloc[0]["Billing_Cycle"]))
            self._reply(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._reply(400, {"error": str(exc)})
        except Exception as exc:
            self._reply(500, {"error": "Model inference failed", "detail": str(exc)})
