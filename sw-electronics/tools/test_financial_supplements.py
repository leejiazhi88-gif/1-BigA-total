"""Regression tests for evidence-bound actuals and quarterly dependencies."""
import copy
from decimal import Decimal
import unittest

from financial_supplements import apply, load, scopes


class SupplementTests(unittest.TestCase):
    def setUp(self):
        self.records = load()
        self.reports = {}
        for s in self.records:
            expected = s['expectedSource']
            self.reports[(s['code'], s['period'])] = dict(
                f_ann_date=expected['announcementDate'], report_type=expected['reportType'],
                n_income_attr_p=expected['profit'], total_revenue=None, revenue=None)

    def test_fill_actual_zeros_without_changing_profit(self):
        old = copy.deepcopy(self.reports)
        self.assertEqual(apply(self.reports, self.records, '20261117'), self.records)
        for key, row in self.reports.items():
            self.assertEqual(row['total_revenue'], 0)
            self.assertEqual(row['n_income_attr_p'], old[key]['n_income_attr_p'])

    def test_new_actual_supersedes_evidence(self):
        row = self.reports[('688091.SH', '20210930')]
        row.update(f_ann_date='20261117', revenue=1234)
        applied = apply(self.reports, self.records, '20261117')
        self.assertEqual(row['revenue'], 1234)
        self.assertIsNone(row['total_revenue'])
        self.assertEqual(len(applied), 2)

    def test_same_version_conflict_stops(self):
        self.reports[('688091.SH', '20210930')]['revenue'] = 1234
        with self.assertRaisesRegex(RuntimeError, '冲突'):
            apply(self.reports, self.records, '20261117')

    def test_changed_version_or_profit_cannot_reuse_missing_value(self):
        for field, value in [('f_ann_date', '20261117'), ('report_type', '1'), ('n_income_attr_p', -1)]:
            with self.subTest(field=field):
                rows = copy.deepcopy(self.reports)
                rows[('688091.SH', '20210930')][field] = value
                with self.assertRaisesRegex(RuntimeError, '已变化'):
                    apply(rows, self.records, '20261117')

    def test_missing_report_stops(self):
        del self.reports[('688091.SH', '20210930')]
        with self.assertRaisesRegex(RuntimeError, '缺少新报表'):
            apply(self.reports, self.records, '20261117')

    def test_scope_includes_following_quarter_and_previous_cumulative(self):
        targets, deps = scopes(self.records, '20260930')
        self.assertEqual(targets, {('688091.SH', '20210930'), ('688091.SH', '20211231'),
            ('688759.SH', '20251231'), ('688759.SH', '20260331'), ('688759.SH', '20260630')})
        self.assertEqual(deps - targets, {('688091.SH', '20210630'), ('688759.SH', '20250930')})
        limited, _ = scopes(self.records, '20260331')
        self.assertNotIn(('688759.SH', '20260630'), limited)

    def test_quarter_differences_use_zero_without_erasing_following_revenue(self):
        self.reports[('688091.SH', '20210630')] = dict(total_revenue=0)
        self.reports[('688091.SH', '20211231')] = dict(total_revenue=4077536.27)
        apply(self.reports, self.records, '20261117')
        q3 = self.reports[('688091.SH', '20210930')]['total_revenue']
        q4 = self.reports[('688091.SH', '20211231')]['total_revenue'] - q3
        self.assertEqual(q3, 0)
        self.assertEqual(q4, 4077536.27)

    def test_beibet_q1_original_income_statement_reconciles(self):
        # Actual PDF page 10: revenue = operating profit + costs - other gains.
        revenue = sum(map(Decimal, ['-52776780.03', '56437000.53', '-869760.19',
            '-2543716.65', '-351058.08', '104314.42']))
        self.assertEqual(revenue, 0)


if __name__ == '__main__':
    unittest.main()
