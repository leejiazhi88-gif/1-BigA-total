import hashlib
import json
import shutil
import socket
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from refresh_inventory import applicable_periods, audit_inventory


ROOT = Path(__file__).resolve().parents[1]


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "work").mkdir()
        # Exercise the actual heterogeneous source shapes, changing only the
        # source under test. Fixtures never run a fetcher or write to the repo.
        source = (ROOT / "work" / "refresh_inventory.py").read_text()
        import re
        names = set(re.findall(r'"([a-z_]+(?:_data|_history|_reports|_holdings|_shares|_trends|_audit|_denominators|_cap|_status))"', source))
        for name in names:
            path = ROOT / "work" / (name + ".json")
            if path.exists():
                shutil.copyfile(path, self.root / "work" / path.name)
        overview = json.loads((self.root / "work" / "market_overview_data.json").read_text())
        self.end = overview["meta"]["requestedEnd"].replace("-", "")

    def change(self, name, callback):
        path = self.root / "work" / (name + ".json")
        data = json.loads(path.read_text())
        callback(data)
        path.write_text(json.dumps(data))

    def audit(self, **kwargs):
        result = audit_inventory(self.root, self.end, **kwargs)
        json.dumps(result, allow_nan=False)
        self.rows = {row["id"]: row for row in result["rows"]}
        return result

    def test_real_repository_is_read_only_offline_and_known_gaps_do_not_block(self):
        paths = [self.root / r["source"] for r in audit_inventory(self.root, self.end)["rows"]]
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        with patch.object(socket, "socket", side_effect=AssertionError("network forbidden")):
            result = self.audit()
        self.assertEqual(result["blockingIssues"], [])
        self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
        self.assertEqual(self.rows["direct.companyDenominator"]["status"], "pending")
        self.assertEqual(self.rows["direct.etf"]["status"], "unavailable")
        self.assertEqual(self.rows["institutional.latestFundAudit"]["status"], "low_coverage")
        self.assertEqual(self.rows["retail.funds"]["status"], "low_coverage")
        for identifier in ("overview.sh.profit", "overview.sz.profit", "retail.all.amount", "retail.all.volume", "retail.all.turnover"):
            self.assertIn(self.rows[identifier]["status"], ("ok", "lagging"))
            row = self.rows[identifier]
            data = json.loads((self.root / row["source"]).read_text())
            market, field = identifier.split(".")[1:]
            points = data[market] if identifier.startswith("overview") else data["series"]
            self.assertEqual(row["latest"], max(p["date"] for p in points if p.get(field) is not None))

    def test_every_required_tab_and_market_has_an_entry(self):
        self.audit()
        for market in ("all", "sh", "sz"):
            for field in ("amount", "volume", "turnover", "marginBalance", "marginFloatRatio"):
                self.assertIn(f"retail.{market}.{field}", self.rows)
            for field in ("blockAmount", "institutionBlockNet", "holderNetShares", "position", "concentration", "etfShares"):
                self.assertIn(f"institutional.{market}.{field}", self.rows)
            for field in ("ipoFunds", "netReduceAmount", "refinance"):
                self.assertIn(f"official.{market}.{field}", self.rows)
        for identifier in ("retail.accounts", "retail.funds", "official.tax", "official.reverseRepo7d", "official.lpr1y", "official.lpr5y", "official.m2.value", "official.social.value", "direct.stocks", "direct.social", "direct.etf", "direct.aggregateDenominator", "direct.companyDenominator", "direct.etfDenominator"):
            self.assertIn(identifier, self.rows)
        for row in self.rows.values():
            self.assertTrue({"id", "label", "job", "frequency", "latest", "checkedAt", "status", "reason"} <= row.keys())

    def test_check_dates_are_not_stamped_by_audit_or_failed_job(self):
        self.change("market_overview_data", lambda x: x["meta"].update(checkedAt=None, updated=None))
        self.audit()
        self.assertEqual(self.rows["direct.stocks"]["checkedAt"], "2026-11-14")
        self.assertEqual(self.rows["overview.sh.close"]["checkedAt"], None)
        self.audit(job_results={"market_overview": {"status": "failed_cached"}}, state={"market_overview": {"checkedAt": "2026-11-12"}})
        self.assertEqual(self.rows["overview.sh.close"]["checkedAt"], "2026-11-12")
        self.assertEqual(self.rows["overview.sh.close"]["status"], "failed")
        for status in ("ok", "reused_success", "cached_not_due"):
            self.audit(job_results={"market_overview": {"status": status}}, state={"market_overview": {"checkedAt": "2026-11-15"}})
            self.assertEqual(self.rows["overview.sh.close"]["checkedAt"], "2026-11-15")

    def test_deadlines_require_annual_and_q1_but_not_just_ended_quarter(self):
        self.assertEqual(applicable_periods("20260430"), ["20250930"])
        self.assertEqual(applicable_periods("20260501"), ["20251231", "20260331"])
        self.assertEqual(applicable_periods("20260831")[-1], "20260331")
        self.assertEqual(applicable_periods("20260901")[-1], "20260630")
        self.assertEqual(applicable_periods("20261031")[-1], "20260630")
        self.assertEqual(applicable_periods("20261101")[-1], "20260930")
        self.assertEqual(applicable_periods("20270101")[-1], "20260930")

    def test_missing_and_malformed_sources_block(self):
        (self.root / "work" / "valuation_data.json").unlink()
        (self.root / "work" / "retail_sentiment_data.json").write_text("{")
        self.assertTrue(self.audit()["blockingIssues"])
        self.assertEqual(self.rows["valuation.sh.pb"]["status"], "failed")
        self.assertEqual(self.rows["retail.all.amount"]["status"], "failed")

    def test_duplicate_unordered_and_future_dates_block(self):
        future = (datetime.strptime(self.end, "%Y%m%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        for mutation in (lambda x: x["trading"].append(x["trading"][-1]),
                         lambda x: x["trading"].reverse(),
                         lambda x: x["trading"][-1].update(date=future)):
            original = (ROOT / "work" / "market_overview_data.json").read_text()
            (self.root / "work" / "market_overview_data.json").write_text(original)
            self.change("market_overview_data", mutation)
            self.audit()
            self.assertEqual(self.rows["overview.trading.amount"]["status"], "failed")

    def test_nonfinite_holdings_and_denominators_block_and_report_is_json_safe(self):
        self.change("national_team_stock_history", lambda x: x["stocks"]["20260930"]["details"][0].update(close=float("nan")))
        self.change("holding_denominators", lambda x: next(iter(x["funds"].values())).update(units=float("inf")))
        self.audit()
        self.assertEqual(self.rows["direct.stocks"]["status"], "failed")
        self.assertEqual(self.rows["direct.etfDenominator"]["status"], "failed")

    def test_pending_company_capital_never_excuses_missing_aggregate(self):
        self.change("a_share_market_cap", lambda x: x["periods"].pop("20260930"))
        self.audit()
        self.assertEqual(self.rows["direct.companyDenominator"]["status"], "pending")
        self.assertEqual(self.rows["direct.aggregateDenominator"]["status"], "failed")

    def test_prior_year_q4_and_latest_manual_checks_cannot_be_omitted(self):
        self.change("national_team_stock_history", lambda x: x["stocks"].pop("20251231"))
        self.change("national_team_etf_history", lambda x: x["reports"].pop())
        self.change("social_security_history", lambda x: x.pop("checkedAt"))
        self.audit()
        for identifier in ("direct.stocks", "direct.social", "direct.etf"):
            self.assertEqual(self.rows[identifier]["status"], "failed")

    def test_same_period_etf_and_aggregate_denominators_are_validated(self):
        self.change("holding_denominators", lambda x: next(iter(x["funds"].values())).update(period="20261231"))
        self.change("a_share_market_cap", lambda x: x["periods"]["20260930"].update(date="20260831"))
        self.audit()
        self.assertEqual(self.rows["direct.etfDenominator"]["status"], "failed")
        self.assertEqual(self.rows["direct.aggregateDenominator"]["status"], "failed")

    def test_empty_history_blocks_but_explicit_null_tail_is_nonblocking(self):
        original = json.loads((self.root / "work" / "retail_sentiment_data.json").read_text())["series"][-1]["date"]
        self.change("large_money_sentiment_data", lambda x: x.update(series=[]))
        self.change("retail_sentiment_data", lambda x: x["series"][-1].update(amount=None))
        self.audit()
        self.assertEqual(self.rows["institutional.all.blockAmount"]["status"], "failed")
        self.assertIn(self.rows["retail.all.amount"]["status"], ("lagging", "unavailable"))
        self.assertNotEqual(self.rows["retail.all.amount"]["latest"], original)

    def test_absent_field_blocks_but_explicit_null_history_is_unavailable(self):
        self.change("retail_sentiment_data", lambda x: [p.pop("amount", None) for p in x["series"]])
        self.change("large_money_sentiment_data", lambda x: [p.update(blockAmount=None) for p in x["series"]])
        self.audit()
        self.assertEqual(self.rows["retail.all.amount"]["status"], "failed")
        self.assertIn("required field absent", self.rows["retail.all.amount"]["reason"])
        self.assertEqual(self.rows["institutional.all.blockAmount"]["status"], "unavailable")
        self.assertIsNone(self.rows["institutional.all.blockAmount"]["latest"])


if __name__ == "__main__":
    unittest.main()
