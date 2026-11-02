import unittest
from official_markets import aggregate


class OfficialMarketsTests(unittest.TestCase):
    def test_ipo_scope_and_duplicate_records(self):
        row = dict(ts_code="600000.SH", ipo_date="20200106", funds=10)
        weeks = aggregate([row, row, {**row, "ts_code": "000001.SZ", "funds": 20},
                           {**row, "ts_code": "920001.BJ", "funds": 999}], "ipoFunds")
        self.assertEqual(weeks["2020-W02"]["sh"], 10)
        self.assertEqual(weeks["2020-W02"]["sz"], 20)

    def test_disclosed_price_units_sign_and_missing(self):
        row = dict(ts_code="600000.SH", ann_date="20200106", holder_name="A", change_vol=1e8, avg_price=10, in_de="DE")
        weeks = aggregate([row, row, {**row, "ts_code": "000001.SZ", "in_de": "IN"},
                           {**row, "holder_name": "B", "avg_price": None}], "netReduceAmount")
        self.assertEqual(weeks["2020-W02"]["sh"], 10)
        self.assertEqual(weeks["2020-W02"]["sz"], -10)


if __name__ == "__main__":
    unittest.main()
