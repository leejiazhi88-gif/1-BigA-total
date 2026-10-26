import json
import unittest
from pathlib import Path

from fetch_national_team_etf_history import parse_report, report_period, summarize_period


class HistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((Path(__file__).parent / "national_team_etf_history.json").read_text())

    def test_history_starts_at_june_2015_and_covers_quarter_ends(self):
        self.assertEqual(self.data["periods"][0], "20150630")
        self.assertEqual(self.data["periods"][-1], "20260930")
        self.assertEqual(len(self.data["periods"]), 46)
        self.assertEqual(len(set((r["code"], r["period"], r["kind"]) for r in self.data["reports"])), len(self.data["reports"]))

    def test_known_old_disclosure_is_valued_in_yi_not_total_fund_assets(self):
        r = next(r for r in self.data["reports"] if (r["code"], r["period"], r["kind"]) == ("510050", "20150630", "interim"))
        self.assertEqual(r["units"], 1043485014)
        self.assertEqual(r["nav"], 2.847)
        self.assertAlmostEqual(r["value_yi"], 1043485014 * 2.847 / 1e8)

    def test_quarterly_missing_disclosures_never_borrow_prior_holdings(self):
        quarters = [r for r in self.data["reports"] if r["kind"] == "quarterly"]
        self.assertGreater(len(quarters), 400)
        self.assertTrue(all(r["status"] == "named_holder_table_not_disclosed" and r.get("value_yi") is None for r in quarters))
        self.assertIsNone(summarize_period(self.data["reports"], self.data["funds"], "20260331")["amount"])
        self.assertIsNone(summarize_period(self.data["reports"], self.data["funds"], "20260630")["amount"])

    def test_new_funds_are_excluded_from_2015_denominator(self):
        first = summarize_period(self.data["reports"], self.data["funds"], "20150630")
        self.assertEqual(first["eligible"], 8)
        self.assertEqual(first["disclosed"], 8)
        latest = summarize_period(self.data["reports"], self.data["funds"], "20251231")
        self.assertEqual(latest["eligible"], 14)
        self.assertEqual(latest["disclosed"], 14)
        self.assertAlmostEqual(latest["amount"], 14749.0648635133)

    def test_partial_coverage_or_no_identified_accounts_is_not_a_zero_total(self):
        rows = [r for r in self.data["reports"] if not (r["code"] == "510300" and r["period"] == "20251231")]
        self.assertIsNone(summarize_period(rows, self.data["funds"], "20251231")["amount"])
        fund = [f for f in self.data["funds"] if f["code"] == "510580"]
        self.assertIsNone(summarize_period(self.data["reports"], fund, "20251231")["amount"])

    def test_unreadable_text_is_a_parsing_error_not_missing_disclosure(self):
        self.assertEqual(parse_report("SNl^t^g" * 100)["status"], "parse_review_required")

    def test_all_identified_values_match_shares_times_same_period_nav(self):
        for r in self.data["reports"]:
            self.assertEqual(r["issues"], [])
            self.assertLessEqual(r["announced"], self.data["checked_at"])
            if r["status"] == "identified":
                self.assertAlmostEqual(sum(h["units"] for h in r["holders"]), r["units"])
                self.assertAlmostEqual(r["units"] * r["nav"] / 1e8, r["value_yi"])
                self.assertLessEqual(sum(h["ratio_pct"] or 0 for h in r["holders"]), 100.01)

    def test_full_reports_are_separate_from_quarters_and_abstracts(self):
        self.assertEqual(report_period("2015年第二季度报告"), ("20150630", "quarterly"))
        self.assertEqual(report_period("2015年半年度报告"), ("20150630", "interim"))
        self.assertIsNone(report_period("2015年半年度报告摘要"))


if __name__ == "__main__":
    unittest.main()
