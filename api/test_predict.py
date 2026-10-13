import unittest

from api.predict import FEATURES, _bill_bundle_cached, _prediction, _subsidy, _units_bundle_cached, _validate_features


class ModelServiceTests(unittest.TestCase):
    @staticmethod
    def feature_row():
        categorical = {
            "Consumer_Type": "Residential",
            "Consumer_Category": "Residential",
            "Region": "South",
            "City": "Chennai",
            "Building_Type": "Independent House",
            "Business_Type": "Not Applicable",
            "Weather": "Hot",
            "Season": "Summer",
            "Tariff_Category": "Residential",
            "Billing_Cycle": "Bi-Monthly",
            "Payment_Status": "Paid",
        }
        return {**{name: 1.0 for name in FEATURES if name not in categorical}, **categorical}

    def test_both_supplied_models_predict(self):
        frame = _validate_features(self.feature_row())
        self.assertTrue(_prediction(_units_bundle_cached(), frame) >= 0)
        self.assertTrue(_prediction(_bill_bundle_cached(), frame) >= 0)

    def test_subsidy_boundary(self):
        self.assertEqual(_subsidy(500, "Residential", "Bi-Monthly")["free_units"], 200)
        self.assertEqual(_subsidy(501, "Residential", "Bi-Monthly")["free_units"], 100)
        self.assertEqual(_subsidy(500, "Commercial", "Bi-Monthly")["free_units"], 0)


if __name__ == "__main__":
    unittest.main()
