# Power Sense model bundles

These are the user-supplied model artifacts used by `api/predict.py`.

- `electricity_units_model.pkl`: GradientBoostingRegressor bundle for predicted consumption.
- `electricity_bill_model.pkl`: CatBoostRegressor bundle for predicted bill amount.

Both bundles contain their original `ColumnTransformer` preprocessing and are loaded independently. The API requires all original feature columns; it does not invent appliance, weather, or household inputs. The serverless endpoint is available on demand until 31 December 2026 and returns HTTP 410 after that date.
