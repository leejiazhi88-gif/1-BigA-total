import unittest

from fetch_national_team_stock_history import canonical_holdings, periods_between, select_disclosed


class StockHistoryTests(unittest.TestCase):
    def test_quarters_include_crisis_quarters_between_interim_reports(self):
        periods = periods_between("20150630", "20260630")
        self.assertEqual(len(periods), 45)
        self.assertEqual(periods[:3], ["20150630", "20150930", "20151231"])
        self.assertEqual(periods[-2:], ["20260331", "20260630"])

    def test_primary_scope_excludes_unlisted_delisted_b_shares_and_collateral(self):
        basic = {"600001.SH": {"list_date": "20000101"},
                 "600002.SH": {"list_date": "20200101"},
                 "600003.SH": {"list_date": "20000101", "delist_date": "20150101"},
                 "900001.SH": {"list_date": "20000101"}}
        row = {"SECUCODE": "600001.SH", "HOLDER_NAME": "汇金公司", "HOLD_NUM": 100,
               "NOTICE_DATE": "2015-08-01 00:00:00", "END_DATE": "2015-06-30 00:00:00"}
        rows = [{**row, "SECUCODE": code} for code in basic]
        rows += [{**row, "HOLDER_NAME": "中国证券金融股份有限公司转融通担保证券账户"},
                 {**row, "HOLDER_NAME": "普通汇金投资公司"}]
        chosen, excluded = canonical_holdings(rows, "20150630", "20261026", basic)
        self.assertEqual(list(chosen), [("600001.SH", "中央汇金投资有限责任公司")])
        self.assertEqual(len(excluded), 5)

    def test_latest_disclosed_revision_is_deduplicated_without_future_information(self):
        basic = {"600001.SH": {"list_date": "20000101"}}
        row = {"SECUCODE": "600001.SH", "HOLDER_NAME": "汇金公司", "HOLD_NUM": 100,
               "NOTICE_DATE": "2015-08-01 00:00:00", "END_DATE": "2015-06-30 00:00:00"}
        rows = [row, {**row, "HOLD_NUM": 200, "NOTICE_DATE": "2015-08-02 00:00:00"},
                {**row, "HOLD_NUM": 300, "NOTICE_DATE": "2015-08-04 00:00:00"}]
        chosen, _ = canonical_holdings(rows, "20150630", "20150803", basic)
        self.assertEqual(next(iter(chosen.values()))["HOLD_NUM"], 200)
        with self.assertRaisesRegex(ValueError, "Conflicting primary"):
            canonical_holdings([row, {**row, "HOLD_NUM": 200}], "20150630", "20150803", basic)

    def test_comparison_data_keeps_period_and_account_deduplication(self):
        row = {"ts_code": "600001.SH", "end_date": "20150630", "ann_date": "20150801",
               "holder_name": "汇金公司", "hold_amount": 100}
        chosen, companies = select_disclosed([row, row, {**row, "end_date": "20150930"}], "20150630", "20150801")
        self.assertEqual(len(chosen), 1)
        self.assertEqual(companies, 1)
        self.assertEqual(chosen[0]["holder_name"], "中央汇金投资有限责任公司")
