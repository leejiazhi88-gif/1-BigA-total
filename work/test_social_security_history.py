import unittest

from fetch_social_security_history import holding_value, portfolio_key, select_holdings


class SocialSecurityTests(unittest.TestCase):
    def row(self, **changes):
        return {"SECUCODE": "600000.SH", "HOLDER_NAME": "全国社保基金一零一组合",
                "NOTICE_DATE": "2026-08-20 00:00:00", "END_DATE": "2026-06-30 00:00:00",
                "HOLD_NUM": 1000000, "SHARES_TYPE": "流通A股", "REFERENCE_MARKET_CAP": 10000000,
                **changes}

    def test_identifies_direct_and_explicit_delegated_portfolios(self):
        self.assertEqual(portfolio_key("全国社保基金一零一组合"), portfolio_key("全国社保基金101组合"))
        self.assertEqual(portfolio_key("华夏基金管理有限公司-社保基金四二二组合"), "social-422")
        self.assertEqual(portfolio_key("中信证券股份有限公司-社保基金1106组合"), "social-1106")
        self.assertEqual(portfolio_key("中国国际金融股份有限公司-社保基金1805组合"), "social-1805")

    def test_does_not_mix_council_transfers_pensions_or_ambiguous_names(self):
        for name in ("全国社会保障基金理事会", "全国社保基金理事会转持二户", "全国社保基金",
                     "基本养老保险基金一零零一组合", "博时基金管理有限公司-社保基金划转三零零一组合",
                     "上海国有资本投资有限公司-委托管理划转社保国有股权基金专户", "全国社保基金-六组合"):
            self.assertIsNone(portfolio_key(name), name)

    def test_deduplicates_aliases_and_keeps_latest_known_disclosure(self):
        base = self.row()
        rows = [base, self.row(HOLDER_NAME="全国社保基金101组合"),
                self.row(NOTICE_DATE="2026-08-21 00:00:00", HOLD_NUM=2000000),
                self.row(NOTICE_DATE="2026-10-28 00:00:00", HOLD_NUM=3000000)]
        selected, excluded = select_holdings(rows, "20260630", "20261027", {"600000.SH": {"list_date": "20000101"}})
        self.assertEqual(len(selected), 1)
        self.assertEqual(next(iter(selected.values()))["HOLD_NUM"], 2000000)
        self.assertEqual(len(excluded), 1)
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            select_holdings([base, self.row(HOLD_NUM=2)], "20260630", "20261027", {"600000.SH": {"list_date": "20000101"}})

    def test_formerly_listed_stocks_are_kept_only_while_listed(self):
        basic = {"600000.SH": {"list_date": "20000101", "delist_date": "20260701"}}
        self.assertEqual(len(select_holdings([self.row()], "20260630", "20261027", basic)[0]), 1)
        basic["600000.SH"]["delist_date"] = "20260630"
        self.assertEqual(len(select_holdings([self.row()], "20260630", "20261027", basic)[0]), 0)

    def test_uses_period_price_and_flags_unverified_units_or_share_classes(self):
        self.assertEqual(holding_value(self.row(), {"close": 10}), (10, "Tushare daily", 0.1))
        self.assertEqual(holding_value(self.row(), None), (10, "Eastmoney period-end reference", 0.1))
        for row, price in ((self.row(SHARES_TYPE="流通A股,H股"), {"close": 10}),
                           (self.row(), {"close": 11}), (self.row(HOLD_NUM=-1), None),
                           (self.row(REFERENCE_MARKET_CAP=None), None)):
            with self.assertRaises(ValueError):
                holding_value(row, price)


if __name__ == "__main__":
    unittest.main()
