"""The 16:30 run must target today, not silently substitute yesterday."""
from datetime import datetime
import unittest
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo
from collect_refresh import latest_quote_day
from daily_refresh import schedule_due
import daily_refresh


class QuoteDayTests(unittest.TestCase):
    calendar = [{'cal_date': '20261116'}, {'cal_date': '20261117'}]

    def selected(self, timestamp):
        return latest_quote_day(self.calendar, datetime.fromisoformat(timestamp).replace(tzinfo=ZoneInfo('Asia/Shanghai')))

    def test_preclose_uses_previous_closed_day(self):
        self.assertEqual(self.selected('2026-11-17T14:59:00'), '20261116')

    def test_1630_must_try_today(self):
        self.assertEqual(self.selected('2026-11-17T16:30:00'), '20261117')

    def test_after_close_and_nontrading_day(self):
        self.assertEqual(self.selected('2026-11-17T15:00:00'), '20261117')
        self.assertEqual(self.selected('2026-11-18T16:30:00'), '20261117')


class ScheduleTests(unittest.TestCase):
    def test_no_work_before_1630(self):
        self.assertFalse(schedule_due(datetime.fromisoformat('2026-11-19T16:29:59+08:00'), None))

    def test_one_attempt_even_after_failure(self):
        current = datetime.fromisoformat('2026-11-19T16:30:00+08:00')
        self.assertTrue(schedule_due(current, '2026-11-18'))
        self.assertFalse(schedule_due(current, '2026-11-19'))

    def test_sleep_catchup_and_next_day(self):
        self.assertTrue(schedule_due(datetime.fromisoformat('2026-11-19T19:00:00+08:00'), '2026-11-18'))
        self.assertFalse(schedule_due(datetime.fromisoformat('2026-11-20T09:00:00+08:00'), '2026-11-19'))
        self.assertTrue(schedule_due(datetime.fromisoformat('2026-11-20T16:30:00+08:00'), '2026-11-19'))

    def test_schedule_uses_shanghai_despite_system_timezone(self):
        self.assertTrue(schedule_due(datetime.fromisoformat('2026-11-19T02:30:00-06:00'), '2026-11-18'))
        self.assertFalse(schedule_due(datetime.fromisoformat('2026-11-19T02:29:00-06:00'), '2026-11-18'))


class PublicationGuards(unittest.TestCase):
    def test_missing_source_does_not_build_or_publish(self):
        with tempfile.TemporaryDirectory() as folder:
            args = SimpleNamespace(workspace=Path(folder), report=Path(folder) / 'report.json')
            report = {}
            with patch.object(daily_refresh, 'clean'), patch.object(daily_refresh.subprocess, 'run') as command, \
                 patch.object(daily_refresh, 'coverage', return_value={'ready': False}), \
                 patch.object(daily_refresh, 'publish') as publish:
                daily_refresh.run(args, report)
            self.assertEqual(report['status'], 'data_not_ready')
            publish.assert_not_called()
            self.assertEqual(command.call_count, 4)  # fetch/ff-only only; no build, commit or push

    def test_concurrent_change_stops_promotion(self):
        with patch.object(daily_refresh, 'clean'), patch.object(daily_refresh.subprocess, 'run'), \
             patch.object(daily_refresh, 'git', return_value='changed'), \
             patch.object(daily_refresh.shutil, 'copy2') as copy:
            with self.assertRaises(RuntimeError):
                daily_refresh.publish(Path('/workspace'), Path('/site'), Path('/legacy'), Path('/stage'),
                                      [('original', 'remote'), ('legacy', 'legacy-remote')])
            copy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
