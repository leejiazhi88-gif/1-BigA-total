import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "work"))
from weekly_dates import align_rows, calendar_week_ends


class WeeklyDatesTests(unittest.TestCase):
    def test_actual_calendar_end_and_preserved_weekly_amount(self):
        def request(token, api, params, fields):
            return [{"cal_date": d, "is_open": 1} for d in ["20260928", "20260929", "20260930", "20261026", "20261030"]]
        rows = [{"date": "2026-10-03", "amount": 12}, {"date": "2026-10-31", "amount": -5}]
        ends = calendar_week_ends("token", request, rows, "20261101")
        actual = align_rows(rows, ends)
        self.assertEqual([row["date"] for row in actual], ["2026-09-30", "2026-10-30"])
        self.assertEqual([row["amount"] for row in actual], [12, -5])
        self.assertEqual(actual[0]["sourcePeriodLabel"], "2026-10-03")
        self.assertEqual(rows[0]["date"], "2026-10-03")

    def test_week_without_exchange_sessions_keeps_original_period_label(self):
        self.assertEqual(align_rows([{"date": "2026-10-10", "amount": 0}], {})[0]["date"], "2026-10-10")


if __name__ == "__main__":
    unittest.main()
