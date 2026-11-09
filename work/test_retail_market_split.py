import unittest

from fetch_retail_sentiment_data import attach_volume, build_daily_series, build_exchange_series, sample_by_week


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

    def test_weekly_mean_includes_all_valid_days_and_keeps_balance_as_last_value(self):
        rows = [
            {"date": "2026-11-06", "amount": 1000, "volume": 20, "turnover": 3, "marginBalance": 900},
            {"date": "2026-11-02", "amount": 100, "volume": 10, "turnover": 1, "marginBalance": 100},
            {"date": "2026-11-03", "amount": 300, "volume": None, "turnover": 2, "marginBalance": None},
        ]
        weekly = sample_by_week(rows)[0]
        self.assertEqual(weekly["amount"], 466.67)
        self.assertEqual(weekly["volume"], 15)
        self.assertEqual(weekly["turnover"], 2)
        self.assertEqual(weekly["marginBalance"], 900)
        self.assertEqual(weekly["weeklySamples"]["amount"]["days"], 3)
        self.assertEqual(weekly["weeklySamples"]["volume"]["days"], 2)

    def test_holiday_and_unfinished_weeks_divide_by_observations_not_five_or_seven(self):
        weekly = sample_by_week([
            {"date": "2026-10-08", "amount": 80},
            {"date": "2026-10-09", "amount": 120},
            {"date": "2026-10-12", "amount": 300},
        ])
        self.assertEqual([(row["date"], row["amount"]) for row in weekly], [("2026-10-09", 100), ("2026-10-12", 300)])
        self.assertEqual(weekly[0]["weeklySamples"]["amount"], {"start": "2026-10-08", "end": "2026-10-09", "days": 2})

    def test_zero_is_valid_missing_is_not_and_each_metric_keeps_its_own_end_date(self):
        weekly = sample_by_week([
            {"date": "2026-11-02", "amount": 0, "turnover": 1},
            {"date": "2026-11-03", "amount": 100, "turnover": None},
            {"date": "2026-11-06", "amount": None, "turnover": 3},
        ])
        self.assertEqual(weekly[0]["date"], "2026-11-03")
        self.assertEqual(weekly[0]["amount"], 50)
        self.assertIsNone(weekly[0]["turnover"])
        self.assertEqual(weekly[1]["date"], "2026-11-06")
        self.assertEqual(weekly[1]["turnover"], 2)
        self.assertIsNone(weekly[1]["amount"])
        self.assertEqual(sample_by_week([{"date": "2026-11-02", "amount": None}]), [])

    def test_iso_week_crossing_calendar_year_is_not_split(self):
        weekly = sample_by_week([{"date": "2020-12-31", "amount": 100}, {"date": "2021-01-01", "amount": 200}])
        self.assertEqual(len(weekly), 1)
        self.assertEqual(weekly[0]["amount"], 150)

    def test_daily_turnover_is_weighted_before_the_weekly_arithmetic_mean(self):
        market = []
        for date, sh_mv, sh_tr, sz_mv, sz_tr in [("20261102", 100, 1, 100, 3), ("20261103", 900, 10, 100, 0)]:
            for code, mv, tr in [("SH_A", sh_mv, sh_tr), ("SH_B", 0, 0), ("SH_STAR", 0, 0), ("SZ_MARKET", sz_mv, sz_tr)]:
                market.append({"trade_date": date, "ts_code": code, "amount": 100, "float_mv": mv, "tr": tr, "vol": 10})
        daily, _ = build_daily_series(market, [], {})
        weekly = sample_by_week(daily)[0]
        self.assertEqual([row["turnover"] for row in daily], [2, 9])
        self.assertEqual(weekly["turnover"], 5.5)
        self.assertEqual(weekly["volume"], 40)

    def test_shenzhen_volume_uses_stock_total_in_shares_and_preserves_missing_sources(self):
        market = [{"trade_date": "20261106", "ts_code": "SZ_MARKET"}]
        volumes = [{"trade_date": "20261106", "ts_code": code, "vol": value} for code, value in [("SZ_MARKET", None), ("SZ_MAIN", 20), ("SZ_GEM", 10)]]
        stock = [{"trade_date": "20261106", "ts_code": "股票", "vol": 5e9}]
        self.assertEqual(attach_volume(market, volumes, stock)[0]["vol"], 50)
        self.assertEqual(attach_volume(market, volumes)[0]["vol"], 30)
        self.assertIsNone(attach_volume(market, volumes[:-1])[0]["vol"])
        volumes[0]["vol"] = 40
        self.assertEqual(attach_volume(market, volumes)[0]["vol"], 40)

    def test_shenzhen_sme_merger_does_not_double_count_boards(self):
        for date, expected in [("20210402", 60), ("20210406", 40)]:
            market = [{"trade_date": date, "ts_code": "SZ_MARKET"}]
            volumes = [{"trade_date": date, "ts_code": code, "vol": value}
                       for code, value in [("SZ_MAIN", 30), ("SZ_SME", 20), ("SZ_GEM", 10)]]
            self.assertEqual(attach_volume(market, volumes)[0]["vol"], expected)


if __name__ == "__main__":
    unittest.main()
