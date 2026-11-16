import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import refresh_dashboard as dashboard


class RefreshDashboardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / "work").mkdir()
        self.logs = self.root / ".tools" / "refresh-logs"
        self.jobs = [("daily", "daily.json", "fetch_daily.py", []),
                     ("fund_report_audit", "audit.json", "audit.py", [])]
        for name, value in (("ROOT", self.root), ("STATE", self.root / ".tools" / "state.json"),
                            ("LOGS", self.logs), ("END_DATE", "20261116")):
            override = patch.object(dashboard, name, value)
            override.start()
            self.addCleanup(override.stop)
        self.catalog = patch.object(dashboard, "task_catalog", return_value=(self.jobs, {}))
        self.catalog.start()
        self.addCleanup(self.catalog.stop)
        self.inventory = patch("refresh_inventory.audit_inventory", return_value={"rows": [], "blockingIssues": []})
        self.audit = self.inventory.start()
        self.addCleanup(self.inventory.stop)

    def args(self, **kwargs):
        return argparse.Namespace(**dict({"full_refresh": False, "reports": False,
                                         "audit_only": False, "retry_failed": False}, **kwargs))

    def report(self):
        return json.loads((self.root / "outputs" / "refresh-latest.json").read_text())

    def test_cached_failure_blocks_publish_and_audit_runs_after_data_job(self):
        calls = []
        def run(job, *args):
            calls.append(job[0])
            return job[0], {"status": "failed_cached" if job[0] == "daily" else "ok"}
        with patch.object(dashboard, "run_job", side_effect=run):
            self.assertEqual(dashboard.refresh(self.args()), 1)
        self.assertEqual(calls, ["daily", "fund_report_audit"])
        self.assertFalse(self.report()["publishReady"])
        self.assertIn("daily", self.report()["blockingIssues"][0])

    def test_retry_reuses_verified_success_and_reruns_failed_task(self):
        self.logs.mkdir(parents=True)
        (self.logs / "latest.json").write_text(json.dumps({"requestedEnd": "20261116", "jobs": {
            "daily": {"status": "ok", "checkedAt": "2026-11-16"},
            "fund_report_audit": {"status": "failed_cached"}}}))
        with patch.object(dashboard, "reusable", side_effect=lambda record, *a: record.get("status") == "ok"), \
             patch.object(dashboard, "run_job", return_value=("fund_report_audit", {"status": "ok"})) as run:
            self.assertEqual(dashboard.refresh(self.args(retry_failed=True)), 0)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], "fund_report_audit")
        self.assertEqual(self.report()["jobs"]["daily"]["status"], "reused_success")

    def test_audit_does_not_fetch_or_overwrite_retry_checkpoint_or_state(self):
        self.logs.mkdir(parents=True)
        checkpoint = self.logs / "latest.json"
        checkpoint.write_text('{"requestedEnd":"20261113"}')
        with patch.object(dashboard, "run_job") as run:
            self.assertEqual(dashboard.refresh(self.args(audit_only=True)), 0)
        run.assert_not_called()
        self.assertEqual(checkpoint.read_text(), '{"requestedEnd":"20261113"}')
        self.assertFalse(dashboard.STATE.exists())
        self.assertTrue((self.logs / "audit-latest.json").exists())
        self.assertTrue(all(row["checkedAt"] is None for row in self.report()["jobs"].values()))

    def test_inventory_crash_produces_failure_report(self):
        self.audit.side_effect = ValueError("invalid periods")
        self.assertEqual(dashboard.refresh(self.args(audit_only=True)), 1)
        self.assertIn("Inventory audit failed", self.report()["blockingIssues"][0])

    def test_invalid_successful_output_is_not_reusable_on_retry(self):
        self.audit.return_value = {"rows": [{"job": "daily", "status": "failed", "reason": "unordered dates"}],
                                   "blockingIssues": ["daily: unordered dates"]}
        with patch.object(dashboard, "run_job", side_effect=lambda job, *a: (job[0], {"status": "ok"})):
            self.assertEqual(dashboard.refresh(self.args()), 1)
        self.assertEqual(self.report()["jobs"]["daily"]["status"], "failed_validation")

    def test_retry_rejects_different_cutoff(self):
        self.logs.mkdir(parents=True)
        (self.logs / "latest.json").write_text('{"requestedEnd":"20261113"}')
        with self.assertRaisesRegex(ValueError, "same MARKET_END_DATE"):
            dashboard.refresh(self.args(retry_failed=True))


if __name__ == "__main__":
    unittest.main()
