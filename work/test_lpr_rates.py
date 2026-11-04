import unittest
from unittest.mock import patch

from lpr_rates import fetch_lpr_history, normalize_quotes


class LprRatesTests(unittest.TestCase):
    def test_launch_dates_and_missing_pre_reform_tenor(self):
        rows = [{"date": "20131025", "1y": 5.71, "5y": None, "source": "Tushare"},
                {"date": "20190820", "1y": 4.25, "5y": 4.85, "source": "Tushare"}]
        series = normalize_quotes(rows[::-1], "20261103")
        self.assertEqual(series[0]["date"], "2013-10-25")
        self.assertIsNone(series[0]["lpr5y"])
        self.assertEqual(series[1]["lpr5y"], 4.85)

    def test_conflicting_invalid_and_future_quotes_are_rejected(self):
        row = {"date": "20261020", "1y": 3, "5y": 3.5, "source": "Tushare"}
        for rows in ([row, {**row, "1y": 3.1}], [{**row, "1y": float("nan")}],
                     [{**row, "date": "20261120"}], [{**row, "5y": None}],
                     [{**row, "date": "20180101"}]):
            with self.assertRaises(ValueError):
                normalize_quotes(rows, "20261103")

    def test_official_feed_supplements_missing_months_without_relabelling_dates(self):
        vendor = {"date": "20260820", "1y": 3, "5y": 3.5}
        supplement = [{"date": "20260920", "1y": 3, "5y": 3.5, "source": "ChinaMoney"},
                      {"date": "20261020", "1y": 3, "5y": 3.5, "source": "ChinaMoney"}]
        with patch("lpr_rates.fetch_range", return_value=[vendor]), \
             patch("lpr_rates.official_quotes", return_value=supplement) as official:
            result = fetch_lpr_history("test", "20261103")
        official.assert_called_once_with("2026-08-20", "2026-11-03")
        self.assertEqual(len(result["series"]), 3)
        self.assertEqual(result["meta"]["end"], "2026-10-20")
        self.assertEqual(result["series"][-1]["source"], "ChinaMoney")

    def test_monthly_due_check_and_current_feed_reuse(self):
        vendor = {"date": "20261020", "1y": 3, "5y": 3.5}
        for end, expected_calls in (("20261103", 0), ("20261120", 1)):
            with patch("lpr_rates.fetch_range", return_value=[vendor]), \
                 patch("lpr_rates.official_quotes", return_value=[]) as official:
                result = fetch_lpr_history("test", end)
            self.assertEqual(official.call_count, expected_calls)
            self.assertEqual(result["series"][-1]["date"], "2026-10-20")

    def test_incomplete_official_response_cannot_erase_published_quotes(self):
        vendor = {"date": "20260820", "1y": 3, "5y": 3.5}
        previous = {"series": [{"date": "2026-10-20"}]}
        with patch("lpr_rates.fetch_range", return_value=[vendor]), \
             patch("lpr_rates.official_quotes", return_value=[]), self.assertRaises(ValueError):
            fetch_lpr_history("test", "20261103", previous)


if __name__ == "__main__":
    unittest.main()
