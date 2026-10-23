import unittest
import json
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fetch_market_overview_data import build_trading
from fetch_valuation_data import build_index_series, parse_chinabond_yield
from fetch_etf_flow_data import daily_flow, build_series
from fetch_national_team_etf_data import normalized_holdings, disclosed_rows, history_point, holder_snapshot
from tushare_client import call_api_pages
import fetch_retail_sentiment_data as retail
import fetch_market_overview_data as overview
import fetch_etf_flow_data as etf_flow


class DataPipelineTests(unittest.TestCase):
    def test_today_prices_do_not_wait_for_unpublished_valuation(self):
        def fetch(token, api, code, fields):
            if api == "index_dailybasic":
                return [{"trade_date": "20261022", "pe_ttm": 20, "total_mv": 4e12}]
            return [{"trade_date": "20261022", "close": 100}, {"trade_date": "20261023", "close": 110}]
        with TemporaryDirectory() as directory:
            output = Path(directory) / "overview.json"
            with patch.object(overview, "get_token", return_value="test"), patch.object(overview, "fetch_by_year", side_effect=fetch), \
                 patch.object(overview, "build_trading", return_value=[{"date": "2026-10-23", "volume": 1, "amount": 2}]), \
                 patch.object(overview, "OUTPUT", output), patch("builtins.print"):
                overview.main()
            data = json.loads(output.read_text())
        self.assertEqual(data["meta"]["end"], "2026-10-23")
        self.assertEqual(data["prices"]["sh"][-1], {"date": "2026-10-23", "close": 110})
        self.assertEqual(data["sh"][-1]["date"], "2026-10-22")
        self.assertEqual(data["sh"][-1]["profit"], 2000)

    def test_trading_uses_full_a_share_markets_and_matching_dates(self):
        markets = {
            "000002.SH": [
                {"trade_date": "20260923", "vol": 1e6, "amount": 1e5},
                {"trade_date": "20260924", "vol": 2e6, "amount": 3e5},
                {"trade_date": "20260928", "vol": 3e6, "amount": 4e5},
            ],
            "399107.SZ": [
                {"trade_date": "20260923", "vol": None, "amount": 2e5},
                {"trade_date": "20260924", "vol": 5e6, "amount": 7e5},
            ],
        }
        with patch("fetch_market_overview_data.fetch_by_year", side_effect=lambda token, api, code, fields: markets[code]):
            rows = build_trading("test")
        self.assertEqual(rows, [{"date": "2026-09-24", "volume": 7.0, "amount": 10.0}])

    def test_missing_bond_yield_does_not_block_pb_or_create_current_spread(self):
        rows = [
            {"trade_date": "20260605", "pe_ttm": 20, "pb": 1.5},
            {"trade_date": "20260924", "pe_ttm": 25, "pb": 2.0},
        ]
        series = build_index_series(rows, ["20260605"], {"20260605": 2.0})
        self.assertEqual(series[0]["equityBondSpread"], 3.0)
        self.assertEqual(series[-1]["date"], "2026-09-24")
        self.assertEqual(series[-1]["pb"], 2.0)
        self.assertIsNone(series[-1]["bond10y"])
        self.assertIsNone(series[-1]["equityBondSpread"])

    def test_etf_flow_converts_ten_thousand_shares_to_hundred_million_yuan(self):
        previous = {"total_share": 1000000, "nav": 2}
        self.assertEqual(daily_flow({"total_share": 1010000, "nav": 2}, previous), (2.0, None))
        self.assertEqual(daily_flow({"total_share": 990000, "nav": 2}, previous), (-2.0, None))
        self.assertEqual(daily_flow({"total_share": 1000000, "nav": 3}, previous), (0.0, None))
        self.assertIsNone(daily_flow({"total_share": 1010000, "nav": None}, previous)[0])
        self.assertEqual(daily_flow({"total_share": 2000000, "nav": 1}, previous), (None, "possible_split"))

    def test_etf_flow_does_not_bridge_missing_trading_days(self):
        calendar = [{"cal_date": "20261008", "pretrade_date": "20260930"},
                    {"cal_date": "20261009", "pretrade_date": "20261008"}]
        raw = {"A": {"20260930": {"total_share": 100, "nav": 1},
                     "20261009": {"total_share": 110, "nav": 1}}}
        result = build_series(calendar, raw, pool=[{"ts_code": "A"}])
        self.assertTrue(all(row["total"] is None and row["coverage"] == 0 for row in result))

    def test_etf_window_ends_at_last_published_date_and_still_has_90_days(self):
        end = datetime(2026, 10, 23)
        dates = [end - timedelta(days=offset) for offset in range(170, -1, -1)]
        dates = [date.strftime("%Y%m%d") for date in dates if date.weekday() < 5]
        calendar = [{"cal_date": day, "pretrade_date": dates[index - 1]} for index, day in enumerate(dates) if index]
        observations = [{"trade_date": day, "total_share": 10000 + index * 100, "nav": 1} for index, day in enumerate(dates[:-1])]
        with TemporaryDirectory() as directory:
            output = Path(directory) / "flow.json"
            with patch.object(etf_flow, "get_token", return_value="test"), patch.object(etf_flow, "OUTPUT", output), \
                 patch.object(etf_flow, "END_DATE", "20261023"), \
                 patch.object(etf_flow, "call_api", side_effect=lambda token, api, params, fields: calendar if api == "trade_cal" else observations), patch("builtins.print"):
                etf_flow.main()
            data = json.loads(output.read_text())
        self.assertEqual(data["meta"]["requestedEnd"], "20261023")
        self.assertEqual(data["meta"]["windowEnd"], "2026-10-22")
        self.assertEqual(data["meta"]["completeDays"], 90)
        self.assertEqual(len(data["series"]), 90)

    def test_partial_etf_disclosures_are_not_scaled_to_full_portfolio(self):
        holdings = normalized_holdings([{"symbol": "000001.SZ", "stk_mkv_ratio": 10, "mkv": 100},
                                       {"symbol": "600000.SH", "stk_mkv_ratio": 20, "mkv": 200}])
        self.assertAlmostEqual(sum(row["weight"] for row in holdings), 0.3)
        point = history_point("20260630", {"A": holdings, "B": []}, {"000001.SZ": 0.2})
        self.assertEqual(point["A"], 2.0)
        self.assertEqual(point["coverage"]["A"], 10.0)
        self.assertIsNone(point["B"])
        self.assertIsNone(point["averageExposure"])

    def test_only_latest_published_revision_for_exact_period_is_used(self):
        rows = [{"end_date": "20260630", "ann_date": date} for date in ("20260730", "20260830", "20261015")]
        rows.append({"end_date": "20260331", "ann_date": "20260901"})
        with patch("fetch_national_team_etf_data.END_DATE", "20261009"):
            self.assertEqual(disclosed_rows(rows, "20260630"), [rows[1]])

    def test_unknown_holder_ratio_is_not_zero_exposure(self):
        common = {"end_date": "20260630", "ann_date": "20260801"}
        rows = [{**common, "ts_code": "A", "holder_name": "中央汇金投资有限责任公司", "hold_float_ratio": None},
                {**common, "ts_code": "B", "holder_name": "Other", "hold_float_ratio": 2}]
        with patch("fetch_national_team_etf_data.call_api", return_value=rows):
            exposure, _ = holder_snapshot("test", "20260630")
        self.assertNotIn("A", exposure)
        self.assertEqual(exposure["B"], 0)

    def test_chinabond_curve_requires_exact_date_and_ten_year_term(self):
        html = '<h2>中债国债收益率曲线(到期)</h2><a href="?workTime=2026-10-09">下载</a>'
        html += '<table><tr><td>1.0y</td><td>1.2</td></tr><tr><td>10.0y</td><td>1.6864</td></tr></table>'
        self.assertEqual(parse_chinabond_yield(html, "2026-10-09"), 1.6864)
        with self.assertRaises(ValueError):
            parse_chinabond_yield(html, "2026-10-08")
        with self.assertRaises(ValueError):
            parse_chinabond_yield(html.replace("10.0y", "30.0y"), "2026-10-09")

    def test_pagination_fetches_tail_and_rejects_repeated_page(self):
        with patch("tushare_client.call_api", side_effect=[[{"id": 1}, {"id": 2}], [{"id": 3}]]) as fetch:
            self.assertEqual(len(call_api_pages("test", "example", {}, "id", 2)), 3)
            self.assertEqual(fetch.call_args.args[2]["offset"], 2)
        with patch("tushare_client.call_api", return_value=[{"id": 1}]):
            with self.assertRaises(RuntimeError):
                call_api_pages("test", "example", {}, "id", 1)

    def test_margin_requires_both_exchanges_on_the_observation_date(self):
        def yearly(token, api, params, fields):
            if api == "daily_info":
                return [{"trade_date": date, "ts_code": params["exchange"] + "_MARKET",
                         "amount": 100, "float_mv": 1000, "tr": 1} for date in ("20261008", "20261009")]
            dates = ("20261008", "20261009") if params["exchange_id"] == "SSE" else ("20261008",)
            return [{"trade_date": date, "exchange_id": params["exchange_id"], "rzye": 1e8, "rzmre": 1e7} for date in dates]
        with TemporaryDirectory() as directory:
            output = Path(directory) / "retail.json"
            with patch.object(retail, "get_token", return_value="test"), patch.object(retail, "yearly", side_effect=yearly), \
                 patch.object(retail, "monthly_limit_counts", return_value={}), patch.object(retail, "OUTPUT", output), patch("builtins.print"):
                retail.main()
            series = json.loads(output.read_text())["series"]
            last = series[-1]
        self.assertEqual(last["date"], "2026-10-09")
        self.assertIsNone(last["marginBalance"])
        self.assertIsNone(last["marginBuyRatio"])
        self.assertEqual(last["amount"], 200)
        self.assertEqual(series[0]["date"], "2026-10-08")
        self.assertEqual(series[0]["marginBalance"], 2)
        self.assertIsNone(series[0]["amount"])


if __name__ == "__main__":
    unittest.main()
