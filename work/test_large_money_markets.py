import unittest

from large_money_markets import build_series, holder_weeks, north_weeks


class MarketSplitTests(unittest.TestCase):
    def test_holder_scope_deduplication_and_signed_totals(self):
        sh = dict(ts_code="600000.SH", ann_date="20200918", holder_name="A", in_de="IN", change_vol=2e8, change_ratio=1)
        sz = {**sh, "ts_code": "000001.SZ", "in_de": "DE", "change_vol": 3e8}
        weeks, excluded = holder_weeks([sh, sh, sz, {**sh, "ts_code": "430001.BJ"}])
        self.assertEqual(weeks["2020-W38"]["sh"], 2)
        self.assertEqual(weeks["2020-W38"]["sz"], -3)
        self.assertEqual(excluded, 1)
        with self.assertRaises(ValueError):
            holder_weeks([{**sh, "change_vol": None}])

    def test_north_units_last_day_launch_and_missing_are_distinct(self):
        rows = [dict(trade_date="20161130", hgt=200, sgt=0, north_money=200),
                dict(trade_date="20161205", hgt=150, sgt=-50, north_money=100),
                dict(trade_date="20161209", hgt="250", sgt="50", north_money="300"),
                dict(trade_date="20161216", hgt=100, sgt=None, north_money=100),
                dict(trade_date="20240819", hgt=100, sgt=100, north_money=200)]
        weeks = north_weeks(rows)
        self.assertEqual(weeks["2016-W48"]["all"], 2)
        self.assertIsNone(weeks["2016-W48"]["sz"])
        self.assertEqual(weeks["2016-W49"], {"date": "20161209", "all": 3, "sh": 2.5, "sz": .5})
        self.assertIsNone(weeks["2016-W50"]["all"])
        self.assertNotIn("2024-W34", weeks)
        issues = []
        invalid = north_weeks([{**rows[1], "north_money": 999}], issues)
        self.assertIsNone(invalid["2016-W49"]["all"])
        self.assertIsNone(invalid["2016-W49"]["sh"])
        self.assertEqual(len(issues), 1)

    def test_block_components_align_dates_and_reconcile(self):
        sh = dict(ts_code="600000.SH", trade_date="20200917", price=10, vol=100, amount=1000,
                  buyer="机构专用", seller="营业部")
        sz = {**sh, "ts_code": "000001.SZ", "trade_date": "20200918", "vol": 200, "amount": 2000,
              "buyer": "营业部", "seller": "机构专用"}
        stocks = {code: {"list_date": "19900101"} for code in ("600000.SH", "000001.SZ")}
        series, _ = build_series([sh, sz], stocks, [], [])
        self.assertEqual(series["sh"][0]["blockDate"], "2020-09-18")
        for field in ("blockAmount", "institutionBlockNet"):
            self.assertAlmostEqual(series["all"][0][field], series["sh"][0][field] + series["sz"][0][field])
        self.assertAlmostEqual(series["all"][0]["institutionBlockNet"], -.1)
        self.assertIsNone(series["sh"][0]["northMoney"])


if __name__ == "__main__":
    unittest.main()
