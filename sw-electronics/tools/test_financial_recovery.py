import copy
import unittest
from financial_recovery import secondary_actuals, historical_quarter, interpolate
from financial_supplements import apply, load


class RecoveryTests(unittest.TestCase):
    def test_blank_secondary_is_not_zero(self):
        reports={('x','20260331'):dict(n_income_attr_p=-10)}
        data={'secondary:x':[dict(SECUCODE='x',REPORT_DATE='2026-03-31',NOTICE_DATE='2026-04-30',TOTAL_OPERATE_INCOME=None,OPERATE_INCOME=None,PARENT_NETPROFIT=-10)]}
        self.assertEqual(secondary_actuals(reports,data,{('x','20260331')},'20261117'),[])
        self.assertIsNone(reports[('x','20260331')].get('total_revenue'))

    def test_secondary_conflict_is_blocked(self):
        reports={('x','20260331'):dict(n_income_attr_p=-10)}
        data={'secondary:x':[dict(SECUCODE='x',REPORT_DATE='2026-03-31',NOTICE_DATE='2026-04-30',TOTAL_OPERATE_INCOME=20,OPERATE_INCOME=20,PARENT_NETPROFIT=-12)]}
        with self.assertRaisesRegex(RuntimeError,'冲突'):
            secondary_actuals(reports,data,{('x','20260331')},'20261117')

    def test_secondary_actual_does_not_replace_existing_field(self):
        reports={('x','20260331'):dict(n_income_attr_p=-10)}
        data={'secondary:x':[dict(SECUCODE='x',REPORT_DATE='2026-03-31',NOTICE_DATE='2026-04-30',TOTAL_OPERATE_INCOME=20,OPERATE_INCOME=20,PARENT_NETPROFIT=-10)]}
        used=secondary_actuals(reports,data,{('x','20260331')},'20261117')
        self.assertEqual(used[0]['metrics'],['revenue'])
        self.assertEqual(reports[('x','20260331')]['n_income_attr_p'],-10)

    def test_half_year_sum_preserved_and_known_profit_not_estimated(self):
        reports={('x','20260331'):dict(n_income_attr_p=-10),('x','20260630'):dict(total_revenue=100,n_income_attr_p=30)}
        old=copy.deepcopy(reports)
        q1=historical_quarter(reports,'x','20260331');q2=historical_quarter(reports,'x','20260630')
        self.assertAlmostEqual(q1['revenue']+q2['revenue'],100/1e8)
        self.assertEqual(q1['profit'],-10/1e8);self.assertEqual(q2['profit'],40/1e8)
        self.assertTrue(all(d['metric']=='revenue' for d in q2['dependencies']))
        self.assertEqual(reports,old)

    def test_no_extrapolation_or_negative_revenue_block(self):
        self.assertEqual(interpolate({('x','20260331'):dict(total_revenue=10)},'x','20260630','revenue'),(None,None))
        self.assertEqual(interpolate({('x','20260331'):dict(total_revenue=10),('x','20260930'):dict(total_revenue=5)},'x','20260630','revenue'),(None,None))

    def test_actual_replaces_estimate_automatically(self):
        reports={('x','20260331'):dict(total_revenue=40,n_income_attr_p=10),('x','20260630'):dict(total_revenue=100,n_income_attr_p=30)}
        self.assertIsNone(historical_quarter(reports,'x','20260630'))

    def test_reviewed_empty_report_restored_with_both_metrics(self):
        supplements=[r for r in load() if r['code']=='600094.SH' and r['period']=='20090331']
        reports={};used=apply(reports,supplements,'20261117')
        self.assertEqual(len(used),2)
        self.assertEqual(reports[('600094.SH','20090331')]['total_revenue'],0)
        self.assertEqual(reports[('600094.SH','20090331')]['n_income_attr_p'],0)

    def test_new_version_cannot_use_old_zero_supplement(self):
        s=next(r for r in load() if r['code']=='600753.SH')
        reports={(s['code'],s['period']):dict(f_ann_date='20261117',report_type='4',n_income_attr_p=-515822.54)}
        with self.assertRaisesRegex(RuntimeError,'已变化'):
            apply(reports,[s],'20261117')


if __name__=='__main__':unittest.main()
