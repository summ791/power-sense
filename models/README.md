# Power Sense model bundles

The original user-supplied artifacts are preserved as `electricity_units_model.pkl` and `electricity_bill_model.pkl`. They remain available for audit and reproducibility but are not imported by the Vercel function.

For the free Vercel deployment, the same fitted preprocessing and estimator parameters are exported to `*_runtime.json` files. The endpoint evaluates those JSON artifacts with the Python standard library only. Local regression tests compare the lightweight evaluator against the original scikit-learn and CatBoost outputs for a fixed feature row.

- Units model: `GradientBoostingRegressor` tree ensemble.
- Bill model: CatBoost symmetric-tree ensemble.

Both outputs remain separate. The endpoint requires all original model feature columns and does not invent appliance, weather, household, or billing inputs. It is available on demand until 31 December 2026 and returns HTTP 410 after that date.
