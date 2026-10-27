import unittest

from fetch_a_share_market_cap import build_period, ROOT, read


class MarketCapTests(unittest.TestCase):
    def fixture(self, date):
        sh = [{"trade_date": date, "ts_code": code, "total_mv": amount, "com_count": count}
              for code, amount, count in [("SH_A", 100, 10), ("SH_STAR", 30, 3), ("SH_B", 5, 1), ("SH_MARKET", 135, 14)]]
        sz = [{"trade_date": date, "ts_code": code, "total_mv": amount * 1e8, "count": count}
              for code, amount, count in [("主板A股", 200, 20), ("创业板A股", 50, 5), ("主板B股", 8, 1), ("股票", 258, 26)]]
        bj = {"marketOpened": "20211115", "source": "official", "rows": [{"trade_date": date, "amount": 7, "count": 2}]}
        return sh, sz, bj

    def test_market_total_excludes_B_shares_and_avoids_double_counting_boards(self):
        result = build_period("20260630", "20260630", *self.fixture("20260630"))
        self.assertEqual(result["amount"], 387)
        self.assertEqual(result["count"], 40)
        self.assertEqual(result["exchanges"]["SZ"]["amount"], 250)

    def test_before_BSE_opening_and_non_trading_period_end(self):
        result = build_period("20210630", "20210630", *self.fixture("20210630"))
        self.assertEqual(result["amount"], 380)
        self.assertEqual(result["exchanges"]["BJ"]["status"], "not_open")
        result = build_period("20240630", "20240628", *self.fixture("20240628"))
        self.assertEqual(result["date"], "20240628")

    def test_missing_or_mixed_period_data_is_not_treated_as_zero(self):
        sh, sz, bj = self.fixture("20260630")
        with self.assertRaisesRegex(ValueError, "Beijing"):
            build_period("20260630", "20260630", sh, sz, {**bj, "rows": []})
        with self.assertRaisesRegex(ValueError, "Missing market"):
            build_period("20260630", "20260630", sh[:1], sz, bj)
        with self.assertRaisesRegex(ValueError, "Mixed dates"):
            build_period("20260630", "20260630", [{**sh[0], "trade_date": "20260331"}], sz, bj)
        with self.assertRaisesRegex(ValueError, "board sum"):
            build_period("20260630", "20260630", [*sh[:-1], {**sh[-1], "total_mv": 130}], sz, bj)

    def test_committed_history_has_all_45_quarters_and_common_market_totals(self):
        data = read(ROOT / "work" / "a_share_market_cap.json")
        holdings = read(ROOT / "work" / "holding_denominators.json")
        self.assertEqual(set(data["periods"]), set(holdings["stocks"]))
        self.assertEqual(len(data["periods"]), 45)
        for row in data["periods"].values():
            self.assertAlmostEqual(row["amount"], sum(r["amount"] for r in row["exchanges"].values()))
            self.assertEqual(row["count"], sum(r["count"] for r in row["exchanges"].values()))
            self.assertGreater(row["amount"], 300000)
            self.assertLessEqual(row["date"], row["period"])


if __name__ == "__main__":
    unittest.main()
