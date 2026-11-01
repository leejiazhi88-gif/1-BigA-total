import unittest

from fetch_retail_sentiment_data import build_daily_series, build_exchange_series


class RetailMarketSplitTests(unittest.TestCase):
    def test_exchange_values_reconcile_with_combined_market(self):
        date = "20200102"
        market_rows = [
            {"trade_date": date, "ts_code": code, "amount": amount, "float_mv": float_mv, "tr": tr}
            for code, amount, float_mv, tr in (
                ("SH_A", 100, 1000, 2),
                ("SH_B", 20, 200, 1),
                ("SH_STAR", 10, 100, 3),
                ("SH_MARKET", 130, 1300, 0),
                ("SZ_MARKET", 70, 700, 4),
            )
        ]
        margins = [
            {"trade_date": date, "exchange_id": "SSE", "rzye": 1e9, "rzmre": 1e8},
            {"trade_date": date, "exchange_id": "SZSE", "rzye": 2e9, "rzmre": 2e8},
        ]
        combined, _ = build_daily_series(market_rows, margins, {})
        markets = build_exchange_series(market_rows, margins)
        all_row, sh, sz = combined[0], markets["sh"][0], markets["sz"][0]
        self.assertEqual((all_row["amount"], sh["amount"], sz["amount"]), (200, 130, 70))
        self.assertEqual((all_row["marginBalance"], sh["marginBalance"], sz["marginBalance"]), (30, 10, 20))
        self.assertAlmostEqual(sh["turnover"], (2000 + 200 + 300) / 1300, places=4)
        self.assertAlmostEqual(all_row["turnover"], 2.65, places=4)
        self.assertAlmostEqual(sh["marginFloatRatio"], 10 / 1300 * 100, places=4)
        self.assertAlmostEqual(sz["marginFloatRatio"], 20 / 700 * 100, places=4)
        self.assertAlmostEqual(all_row["marginFloatRatio"], 30 / 2000 * 100, places=4)


if __name__ == "__main__":
    unittest.main()
