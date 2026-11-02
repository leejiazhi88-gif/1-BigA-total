import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import refresh_cache as cache
from refresh_dashboard import due


class IncrementalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.override = patch.object(cache, "CACHE", self.path / "cache")
        self.override.start()
        self.addCleanup(self.override.stop)
        self.env = patch.dict(os.environ, {"MARKET_END_DATE": "20261102", "MARKET_FULL_REFRESH": "0"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def fetch(self, fn, end="20261102", start="20260101", **kwargs):
        return cache.fetch_range("test", "daily", {"start_date": start, "end_date": end}, "trade_date,value", fn, **kwargs)

    def test_overlap_replaces_revisions_preserves_old_history_and_extends(self):
        old = [{"trade_date": "20260102", "value": 1}, {"trade_date": "20261001", "value": 2}]
        self.fetch(Mock(return_value=old), end="20261023")
        fresh = [{"trade_date": "20261001", "value": 3}, {"trade_date": "20261102", "value": 4}]
        fn = Mock(return_value=fresh)
        self.assertEqual(self.fetch(fn), [old[0], *fresh])
        self.assertEqual(fn.call_args.args[2]["start_date"], "20260925")

    def test_empty_regression_and_invalid_dates_leave_cache_unchanged(self):
        self.fetch(Mock(return_value=[{"trade_date": "20261102", "value": 1}]))
        target = next((self.path / "cache").glob("*.json"))
        before = target.read_bytes()
        for rows in ([], [{"trade_date": "20261103", "value": 2}]):
            with self.assertRaises(ValueError):
                self.fetch(Mock(return_value=rows))
            self.assertEqual(target.read_bytes(), before)

    def test_old_year_reused_but_full_mode_rechecks(self):
        fn = Mock(return_value=[{"trade_date": "20250102", "value": 1}])
        self.fetch(fn, start="20250101", end="20251231")
        fn.reset_mock()
        self.fetch(fn, start="20250101", end="20251231")
        fn.assert_not_called()
        with patch.dict(os.environ, {"MARKET_FULL_REFRESH": "1"}):
            self.fetch(fn, start="20250101", end="20251231")
        fn.assert_called_once()

    def test_migrate_raw_cache_and_do_not_reuse_different_start(self):
        seed = self.path / "old.json"
        cache.write_json(seed, {"api": "daily", "params": {"start_date": "20250101", "end_date": "20251231"},
            "fields": "trade_date,value", "rows": [{"trade_date": "20250102", "value": 1}]})
        fn = Mock(return_value=[])
        self.fetch(fn, start="20250101", end="20251231", seeds=[seed])
        fn.assert_not_called()
        self.fetch(fn, start="20241201", end="20251231", seeds=[seed])
        fn.assert_called_once()

    def test_disclosure_cooldowns_and_force(self):
        source = self.path / "report.json"
        cache.write_json(source, {"meta": {"checkedAt": "2026-11-02"}})
        self.assertFalse(due(source, {}, "report", 7, "20261103"))
        self.assertTrue(due(source, {}, "report", 7, "20261109"))
        self.assertTrue(due(source, {}, "report", 7, "20261201"))
        self.assertTrue(due(source, {}, "report", 7, "20261103", True))
        self.assertTrue(due(source, {"report": {"checkedAt": "2026-11-02", "requestedEnd": "20261001"}}, "report", 7, "20261103"))
        self.assertTrue(due(self.path / "missing.json", {}, "report", 7, "20261103"))


if __name__ == "__main__":
    unittest.main()
