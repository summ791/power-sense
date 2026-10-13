import unittest

from api.predict import FEATURES, _bill_bundle_cached, _predict_bill, _predict_units, _subsidy, _transform, _units_bundle_cached, _validate_features


class ModelServiceTests(unittest.TestCase):
    @staticmethod
    def feature_row():
        categorical = {
            "Consumer_Type": "Residential", "Consumer_Category": "Residential", "Region": "South", "City": "Chennai", "Building_Type": "Independent House", "Business_Type": "Not Applicable", "Weather": "Hot", "Season": "Summer", "Tariff_Category": "Residential", "Billing_Cycle": "Bi-Monthly", "Payment_Status": "Paid",
        }
        return {**{name: 1.0 for name in FEATURES if name not in categorical}, **categorical}

    def test_both_supplied_models_predict_with_dependency_free_runtime(self):
        row = _validate_features(self.feature_row())
        units = _units_bundle_cached()
        bill = _bill_bundle_cached()
        self.assertAlmostEqual(_predict_units(units, _transform(row, units["preprocessor"])), 168.12339048988943, places=5)
        self.assertAlmostEqual(_predict_bill(bill, _transform(row, bill["preprocessor"])), 1145.8562358386807, places=5)

    def test_subsidy_boundary(self):
        self.assertEqual(_subsidy(500, "Residential", "Bi-Monthly")["free_units"], 200)
        self.assertEqual(_subsidy(501, "Residential", "Bi-Monthly")["free_units"], 100)
        self.assertEqual(_subsidy(500, "Commercial", "Bi-Monthly")["free_units"], 0)


if __name__ == "__main__":
    unittest.main()
