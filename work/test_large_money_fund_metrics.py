import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import fetch_large_money_fund_metrics as metrics
from fetch_large_money_fund_metrics import aggregate_report, etf_point, is_active


class ReportsTest(unittest.TestCase):
    def test_market_positions_and_concentration(self):
        funds = {"A": {}, "B": {}}
        nav = [dict(ts_code=c, nav_date="20260630", net_asset=1000) for c in funds]
        rows = []
        for fund in funds:
            for i in range(20):
                rows.append(dict(ts_code=fund, symbol=f"{600000+i:06d}.SH" if i < 12 else f"{1+i:06d}.SZ",
                                 mkv=20 if fund == "A" else 40, stk_mkv_ratio=5,
                                 ann_date="20260830", end_date="20260630"))
        result = aggregate_report("20260630", funds, nav, rows)
        self.assertEqual(result["all"]["position"], 60)
        self.assertEqual(result["sh"]["position"] + result["sz"]["position"], 60)
        self.assertEqual(result["all"]["concentration"], 50)
        self.assertEqual(result["sz"]["concentration"], 100)
        self.assertAlmostEqual(result["sh"]["concentration"], 10 / 12 * 100, places=4)

    def test_dedup_latest_and_incomplete(self):
        funds = {"A": {}, "C": {}, "missing": {}}
        nav = [dict(ts_code=c, nav_date="20260630", net_asset=100) for c in funds]
        row = dict(ts_code="A", symbol="600000.SH", mkv=80, stk_mkv_ratio=100,
                   ann_date="20260830", end_date="20260630")
        result = aggregate_report("20260630", funds, nav, [row, dict(row, ann_date="20260720", mkv=70), dict(row, ts_code="C")])
        self.assertEqual(result["funds"], 1)
        self.assertEqual(result["duplicatesExcluded"], ["C"])
        self.assertEqual(result["coverage"], 50)
        self.assertEqual(result["all"]["position"], 80)
        partial = aggregate_report("20260630", funds, nav, [dict(row, stk_mkv_ratio=70)])
        self.assertIsNone(partial["all"]["position"])
        conflict = aggregate_report("20260630", funds, nav, [row, dict(row, mkv=90)])
        self.assertEqual(conflict["conflictsExcluded"], ["A"])
        self.assertIsNone(conflict["all"]["position"])

    def test_active_selection(self):
        self.assertTrue(is_active(dict(fund_type="混合型", name="成长精选")))
        self.assertFalse(is_active(dict(fund_type="股票型", name="增强指数")))


class EtfTest(unittest.TestCase):
    def history(self, code, date="20261023", listed="20200101", delisted=None):
        return (dict(ts_code=code, list_date=listed, delist_date=delisted), [date], {date: 5})

    def test_units_grouping_and_missing_not_zero(self):
        histories = [self.history("510300.SH"), self.history("159919.SZ")]
        point = etf_point("20261023", histories)
        self.assertEqual((point["all"], point["sh"], point["sz"]), (10, 5, 5))
        histories.append(self.history("159915.SZ", date="20260930"))
        point = etf_point("20261023", histories)
        self.assertIsNone(point["sz"])
        self.assertIsNone(point["all"])
        self.assertEqual(point["sh"], 5)

    def test_listing_dates_and_no_future_carry(self):
        histories = [self.history("510300.SH"), self.history("159919.SZ", listed="20261024"),
                     self.history("159915.SZ", delisted="20261023")]
        point = etf_point("20261023", histories)
        self.assertEqual(point["all"], 5)
        self.assertEqual(point["eligible"]["sz"], 0)
        self.assertIsNone(point["sz"])
        self.assertIsNone(etf_point("20261022", [self.history("510300.SH")])["all"])


class PaginationTest(unittest.TestCase):
    def test_page_order_and_resume(self):
        data = [{"id": i} for i in range(5)]
        def response(token, api, params, fields):
            return data[params["offset"]:params["offset"] + params["limit"]]
        with tempfile.TemporaryDirectory() as directory, patch.object(metrics, "CACHE", Path(directory)), \
                patch.object(metrics.time, "sleep"), patch.object(metrics, "call_api", side_effect=response) as api:
            self.assertEqual(metrics.portfolio_pages("", {}, "id", 2, "test"), data)
            self.assertEqual(api.call_count, 4)
            api.reset_mock()
            self.assertEqual(metrics.portfolio_pages("", {}, "id", 2, "test"), data)
            api.assert_not_called()

    def test_repeated_page_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(metrics, "CACHE", Path(directory)), \
                patch.object(metrics.time, "sleep"), patch.object(metrics, "call_api", return_value=[{"id": 1}, {"id": 2}]):
            with self.assertRaisesRegex(RuntimeError, "Repeated"):
                metrics.portfolio_pages("", {}, "id", 2, "test")


if __name__ == "__main__":
    unittest.main()
