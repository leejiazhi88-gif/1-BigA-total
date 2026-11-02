import unittest
from fetch_northbound_holdings import aggregate, combine


class HoldingsTest(unittest.TestCase):
    def test_value_ratio_and_duplicate(self):
        row = dict(ts_code="600000.SH", trade_date="20260930", vol=100000000)
        prices = {"600000.SH": dict(close=10, date="20260930")}
        result = aggregate([row, row], prices, 200, "sh", "20260930")
        self.assertEqual((result["value"], result["ratio"], result["count"]), (10, 5, 1))
        conflict = aggregate([row, dict(row, vol=2)], prices, 200, "sh", "20260930")
        self.assertIsNone(conflict["value"])
        self.assertEqual(conflict["status"], "conflicting_records")
        self.assertIsNone(combine(result, conflict)["value"])

    def test_missing_and_carried_price(self):
        row = dict(ts_code="600000.SH", trade_date="20260930", vol=100000000)
        self.assertIsNone(aggregate([row], {}, 200, "sh", "20260930")["value"])
        result = aggregate([row], {"600000.SH": dict(close=10, date="20260929")}, 200, "sh", "20260930")
        self.assertEqual(result["carriedPrices"][0]["date"], "20260929")

    def test_combined_denominator_before_launch(self):
        sh = dict(value=10, denominator=200, count=1, status="available")
        sz = aggregate([], {}, 300, "sz", "20160630")
        self.assertEqual(combine(sh, sz)["ratio"], 2)
        self.assertIsNone(combine(sh, aggregate([], {}, 300, "sz", "20260930"))["value"])
        self.assertEqual(combine(sh, dict(value=20, denominator=300, count=1, status="available"))["ratio"], 6)


if __name__ == "__main__":
    unittest.main()
