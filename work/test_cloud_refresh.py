import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import cloud_refresh as cloud


class CloudRefreshTests(unittest.TestCase):
    def test_shanghai_weekend_skips_even_when_utc_is_friday(self):
        api = Mock()
        result = cloud.trading_day(datetime(2026, 11, 20, 18, tzinfo=timezone.utc), None, api)
        self.assertEqual(result["date"], "20261121")
        self.assertFalse(result["is_open"])
        api.assert_not_called()

    def test_exchange_holiday_skips_without_fetching_market_data(self):
        def api(token, name, params, fields):
            self.assertEqual(name, "trade_cal")
            self.assertEqual(params["start_date"], "20261001")
            self.assertEqual(params["end_date"], "20261001")
            return [{"exchange": params["exchange"], "cal_date": "20261001", "is_open": 0}]
        result = cloud.trading_day(datetime(2026, 10, 1, 16, 30, tzinfo=cloud.SHANGHAI), "test", api)
        self.assertEqual(result["calendars"], {"SSE": False, "SZSE": False})
        self.assertEqual(result["reason"], "exchange_holiday")

    def test_open_day_requires_both_calendars(self):
        api = Mock(side_effect=lambda token, name, params, fields: [
            {"exchange": params["exchange"], "cal_date": "20261119", "is_open": "1"}])
        result = cloud.trading_day(datetime(2026, 11, 19, 8, 30, tzinfo=timezone.utc), "test", api)
        self.assertTrue(result["is_open"])
        self.assertEqual(api.call_count, 2)
        self.assertEqual(result["startedAt"], "2026-11-19T16:30:00+08:00")

    def test_missing_secret_and_bad_calendar_fail_instead_of_skip(self):
        now = datetime(2026, 11, 19, 16, 30, tzinfo=cloud.SHANGHAI)
        with self.assertRaisesRegex(ValueError, "TUSHARE_TOKEN"):
            cloud.trading_day(now, None)
        for rows in ([], [{"exchange": "SSE", "cal_date": "20261118", "is_open": 1}],
                     [{"exchange": "SSE", "cal_date": "20261119", "is_open": None}],
                     [{"exchange": "SZSE", "cal_date": "20261119", "is_open": 1}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                cloud.trading_day(now, "test", Mock(return_value=rows))
        api = Mock(side_effect=lambda t, n, p, f: [{"exchange": p["exchange"],
                    "cal_date": "20261119", "is_open": int(p["exchange"] == "SSE")}])
        with self.assertRaisesRegex(ValueError, "disagreement"):
            cloud.trading_day(now, "test", api)
        with self.assertRaises(TimeoutError):
            cloud.trading_day(now, "test", Mock(side_effect=TimeoutError()))

    def test_previous_report_cannot_claim_this_run_succeeded(self):
        calendar = {"date": "20261119", "startedAt": "2026-11-19T16:30:00+08:00"}
        for report in ({}, {"requestedEnd": "20261118", "generatedAt": "2026-11-19T16:40:00"},
                       {"requestedEnd": "20261119", "generatedAt": "2026-11-19T16:00:00"},
                       {"requestedEnd": "20261119", "generatedAt": "bad"}):
            self.assertFalse(cloud.current_report(report, calendar))
        self.assertTrue(cloud.current_report({"requestedEnd": "20261119", "generatedAt": "2026-11-19T16:40:00"}, calendar))

    def test_availability_excludes_monthly_quarterly_and_historical_series(self):
        rows = [dict(frequency="daily", latest="2026-11-19", status="ok"),
                dict(frequency="weekly", latest="2026-11-18", status="lagging"),
                dict(frequency="daily", latest="2026-11-19", status="unavailable"),
                dict(frequency="monthly", latest="2026-10-31", status="ok"),
                dict(frequency="quarterly", latest="20260930", status="ok"),
                dict(frequency="historical weekly", latest="2024-08-16", status="unavailable")]
        result = cloud.freshness({"inventory": {"rows": rows}}, "20261119")
        self.assertEqual(result["dailyWeeklyMetrics"], 3)
        self.assertEqual(result["observedOnTargetDate"], 1)
        self.assertEqual(result["percent"], 33.33)
        self.assertEqual(len(result["notCurrent"]), 2)

    def test_output_allowlist_excludes_source_code_private_cache_and_subsite(self):
        paths = cloud.allowed_outputs()
        for required in ("index.html", "work/market_overview_data.json", "work/refinancing_issuance_records.json",
                         "outputs/active-fund-latest-report-audit.json", "outputs/cloud-refresh-latest.json"):
            self.assertIn(required, paths)
        self.assertFalse(any(path.startswith(("sw-electronics/", ".tools/")) or path.endswith(".py") for path in paths))

    def test_commit_rejects_failed_build_or_remote_race(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "outputs").mkdir()
            calendar = {"date": "20261119", "iso_date": "2026-11-19", "is_open": True,
                        "startedAt": "2026-11-19T16:30:00+08:00"}
            (root / "calendar.json").write_text(json.dumps(calendar))
            (root / "outputs/refresh-latest.json").write_text(json.dumps({"requestedEnd": "20261119",
                "generatedAt": "2026-11-19T16:40:00", "publishReady": True, "blockingIssues": []}))
            cloud_path = root / "outputs/cloud.json"
            cloud_path.write_text(json.dumps({"date": "20261119", "buildSucceeded": False}))
            with patch.object(cloud, "ROOT", root), patch.object(cloud, "CALENDAR", root / "calendar.json"), \
                 patch.object(cloud, "REPORT", cloud_path), patch.object(cloud, "git") as git:
                with self.assertRaisesRegex(ValueError, "stale refresh"):
                    cloud.commit()
                git.assert_not_called()
                cloud_path.write_text(json.dumps({"date": "20261119", "buildSucceeded": True}))
                git.side_effect = ["index.html", "", "local-revision", "remote-revision"]
                with self.assertRaisesRegex(ValueError, "Remote main changed"):
                    cloud.commit()
                self.assertFalse(any(call.args[0] in ("add", "push", "commit") for call in git.call_args_list))

    def test_real_git_commit_pushes_outputs_but_preserves_untracked_private_file(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "checkout"
            bare = parent / "remote.git"
            def run(*args, cwd=parent):
                return subprocess.check_output(["git", *args], cwd=cwd, stderr=subprocess.STDOUT, text=True)
            run("init", "--bare", str(bare))
            run("init", "-b", "main", str(root))
            run("config", "user.name", "Test", cwd=root)
            run("config", "user.email", "test@example.test", cwd=root)
            (root / "index.html").write_text("old page")
            run("add", "index.html", cwd=root)
            run("commit", "-m", "Initial", cwd=root)
            run("remote", "add", "origin", str(bare), cwd=root)
            run("push", "-u", "origin", "main", cwd=root)
            (root / "outputs").mkdir()
            (root / ".tools").mkdir()
            (root / "index.html").write_text("new page")
            (root / "private.txt").write_text("unrelated local file")
            calendar = {"date": "20261119", "iso_date": "2026-11-19", "is_open": True,
                        "startedAt": "2026-11-19T16:30:00+08:00"}
            (root / ".tools/calendar.json").write_text(json.dumps(calendar))
            (root / "outputs/refresh-latest.json").write_text(json.dumps({"requestedEnd": "20261119",
                "generatedAt": "2026-11-19T16:40:00", "publishReady": True, "blockingIssues": []}))
            (root / "outputs/cloud-refresh-latest.json").write_text(json.dumps({
                "date": "20261119", "buildSucceeded": True}))
            with patch.object(cloud, "ROOT", root), patch.object(cloud, "CALENDAR", root / ".tools/calendar.json"), \
                 patch.object(cloud, "REPORT", root / "outputs/cloud-refresh-latest.json"), \
                 patch.object(cloud, "output") as output, patch.object(cloud, "summary"):
                cloud.commit()
                output.assert_called_once_with({"changed": True})
            self.assertEqual(run("--git-dir=" + str(bare), "show", "main:index.html"), "new page")
            self.assertNotIn("private.txt", run("--git-dir=" + str(bare), "ls-tree", "-r", "--name-only", "main"))
            self.assertNotIn(".tools", run("--git-dir=" + str(bare), "ls-tree", "-r", "--name-only", "main"))
            self.assertEqual((root / "private.txt").read_text(), "unrelated local file")

    def test_live_verification_requires_both_revision_and_exact_html(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_bytes(b"expected page")
            response = Mock()
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            response.read.side_effect = [b"other revision", b"abc123\n", b"wrong page", b"abc123\n", b"expected page"]
            with patch.object(cloud, "ROOT", root), patch.object(cloud, "git", return_value="abc123"), \
                 patch.dict(cloud.os.environ, {"PAGE_URL": "https://example.test/"}), \
                 patch.object(cloud.urllib.request, "urlopen", return_value=response) as fetch, \
                 patch.object(cloud.time, "sleep"), patch.object(cloud, "summary") as summary:
                cloud.verify_live()
                self.assertEqual(fetch.call_count, 5)
                self.assertIn("Published and verified", summary.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
