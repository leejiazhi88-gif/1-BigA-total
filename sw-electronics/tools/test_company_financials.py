"""Verify financial windows before exposing them in compact company tables."""
import unittest
from build_lazy_payloads import rolling_financials


class CompanyFinancialTests(unittest.TestCase):
    quarters=['2025Q4','2026Q1','2026Q2','2026Q3']

    def rows(self):
        return [dict(code='example',quarter=q,revenue=str(r),profit=str(p),status='reported')
            for q,r,p in zip(self.quarters,[20,0,40,10],[-4,0,2,-1])]

    def result(self, rows):
        return rolling_financials(rows,self.quarters)['example']

    def test_four_quarters_accept_zero_and_negative_actuals(self):
        self.assertEqual(self.result(self.rows()),[70,-3,4,0,0])

    def test_partial_history_is_not_a_four_quarter_total(self):
        self.assertEqual(self.result(self.rows()[1:]),[None,None,3,0,0])

    def test_any_missing_metric_blocks_both_totals(self):
        for key,value in [('profit',''),('revenue','nan'),('status','missing')]:
            with self.subTest(key=key):
                rows=self.rows();rows[0][key]=value
                self.assertEqual(self.result(rows),[None,None,4,0,1])

    def test_estimate_in_an_earlier_quarter_remains_visible(self):
        rows=self.rows();rows[0]['status']='estimated'
        self.assertEqual(self.result(rows),[70,-3,4,1,0])

    def test_future_or_latest_quote_does_not_add_a_fifth_quarter(self):
        rows=self.rows()+[dict(code='example',quarter='最新',revenue='999',profit='999',status='reported')]
        self.assertEqual(self.result(rows),[70,-3,4,0,0])

    def test_duplicate_quarter_cannot_double_count(self):
        with self.assertRaises(AssertionError):
            self.result(self.rows()+[self.rows()[0]])


if __name__=='__main__':
    unittest.main()
