import json
import os
import tempfile
import unittest
from pathlib import Path

from refresh_jobs import code_signature, fingerprints, refresh_lock, reusable, run_job, validate_history


class RefreshJobTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "work").mkdir()
        self.logs = self.root / ".tools" / "refresh-logs"
        self.logs.mkdir(parents=True)
        self.env = {**os.environ, "MARKET_END_DATE": "20261116"}

    def script(self, source, key="sample", cache="sample.json"):
        (self.root / "work" / "sample.py").write_text(source)
        return key, cache, "sample.py", []

    def run_sample(self, job):
        return run_job(job, self.root, self.logs, self.env, code_signature(self.root))[1]

    def test_failed_task_restores_all_published_outputs(self):
        for name in ("refinancing_data.json", "refinancing_issuance_records.json"):
            (self.root / "work" / name).write_text('{"version":"original"}')
        job = self.script("from pathlib import Path\n"
                          "Path('work/refinancing_data.json').write_text('{\"bad\":true}')\n"
                          "Path('work/refinancing_issuance_records.json').write_text('truncated')\n"
                          "raise RuntimeError('interrupted')\n", "refinancing", "refinancing_data.json")
        record = self.run_sample(job)
        self.assertEqual(record["status"], "failed_cached")
        for name in ("refinancing_data.json", "refinancing_issuance_records.json"):
            self.assertEqual(json.loads((self.root / "work" / name).read_text()), {"version": "original"})

    def test_exit_zero_with_invalid_json_or_nonfinite_still_fails(self):
        target = self.root / "work" / "sample.json"
        target.write_text('{"original":true}')
        for value in ("incomplete", '{"value":NaN}', "[]", '{"meta":{"missingBondDates":["20261116"]}}',
                      '{"failures":["source timeout"]}'):
            job = self.script("from pathlib import Path\nPath('work/sample.json').write_text(" + repr(value) + ")\n")
            self.assertEqual(self.run_sample(job)["status"], "failed_cached")
            self.assertEqual(target.read_text(), '{"original":true}')

    def test_first_run_failure_does_not_leave_new_partial_output(self):
        job = self.script("from pathlib import Path\nPath('work/sample.json').write_text('broken')\n")
        self.assertEqual(self.run_sample(job)["status"], "failed")
        self.assertFalse((self.root / "work" / "sample.json").exists())

    def test_retry_requires_identical_code_command_and_every_output(self):
        job = self.script("from pathlib import Path\nPath('work/sample.json').write_text('{\"ready\":true}')\n")
        signature = code_signature(self.root)
        record = self.run_sample(job)
        self.assertTrue(reusable(record, job, self.root, signature))
        self.assertFalse(reusable(record, (*job[:3], ["--changed"]), self.root, signature))
        self.assertFalse(reusable(record, job, self.root, "changed-code"))
        (self.root / "work" / "sample.json").write_text('{"edited":true}')
        self.assertFalse(reusable(record, job, self.root, signature))
        (self.root / "work" / "sample.json").unlink()
        self.assertFalse(reusable(record, job, self.root, signature))

    def test_lost_older_history_is_rejected_and_restored(self):
        target = self.root / "work" / "sample.json"
        target.write_text('{"series":[{"date":"2020-01-01","value":1},{"date":"2026-11-13","value":2}]}')
        before = target.read_bytes()
        job = self.script("from pathlib import Path\nPath('work/sample.json').write_text('{\"series\":[{\"date\":\"2026-11-16\",\"value\":3}]}')\n")
        self.assertEqual(self.run_sample(job)["status"], "failed_cached")
        self.assertEqual(target.read_bytes(), before)

    def test_recent_observation_dates_may_move_and_null_schema_can_change(self):
        old = {"markets": {"sh": [{"date": "2026-11-12", "value": None}]}}
        new = {"markets": {"sh": [{"date": "2026-11-16", "value": 1}]}}
        validate_history(old, new, "20261116")

    def test_lock_rejects_overlapping_refresh_and_releases_after_error(self):
        target = self.root / "refresh.lock"
        with self.assertRaisesRegex(ValueError, "test"):
            with refresh_lock(target):
                with self.assertRaisesRegex(RuntimeError, "Another refresh"):
                    with refresh_lock(target):
                        pass
                raise ValueError("test")
        with refresh_lock(target):
            pass


if __name__ == "__main__":
    unittest.main()
