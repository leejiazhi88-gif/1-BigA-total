import unittest

from fetch_holding_denominators import capital_at, fund_totals


class HoldingDenominatorTests(unittest.TestCase):
    def capital(self, **changes):
        return {"END_DATE": "2015-01-01 00:00:00", "NOTICE_DATE": "2015-01-02 00:00:00",
                "TOTAL_A_SHARES": 1000, "TOTAL_SHARES": 10000, "LISTED_A_SHARES": 600,
                "LIMITED_A_SHARES": 400, "SECURITY_CODE": "601939", **changes}

    def test_uses_historical_A_share_capital_without_H_shares_or_future_changes(self):
        rows = [self.capital(), self.capital(END_DATE="2025-01-01 00:00:00", TOTAL_A_SHARES=2000,
                                           LIMITED_A_SHARES=1400)]
        self.assertEqual(capital_at(rows, "20150630")["shares"], 1000)
        self.assertEqual(capital_at(rows, "20250630")["shares"], 2000)
        with self.assertRaisesRegex(ValueError, "No capital"):
            capital_at(rows, "20141231")

    def test_unknown_or_conflicting_share_classes_block_export(self):
        for rows in ([self.capital(TOTAL_A_SHARES=None)], [self.capital(LIMITED_A_SHARES=300)],
                     [self.capital(), self.capital(TOTAL_A_SHARES=2000)]):
            with self.assertRaises(ValueError):
                capital_at(rows, "20150630")

    def test_foreign_shares_remain_excluded_after_H_share_delisting(self):
        row = self.capital(TOTAL_A_SHARES=700, TOTAL_SHARES=1200, NON_FREE_SHARES=200)
        adjustment = {"totalShares": 1200, "unlistedForeignShares": 200, "aShares": 1000, "source": "report"}
        result = capital_at([row], "20150630", adjustment=adjustment)
        self.assertEqual(result["shares"], 1000)
        self.assertEqual(result["originalSourceAShares"], 700)
        with self.assertRaises(ValueError):
            capital_at([{**row, "NON_FREE_SHARES": 300}], "20150630", adjustment=adjustment)

    def test_fund_totals_reconcile_to_NAV_and_published_ownership(self):
        text = "报告期末基金份额总额 1,000.00 份\n期末基金资产净值 2,000.00\n本报告期期末基金份额总额 1,000.00"
        result = fund_totals(text, 2, [{"units": 300, "ratio_pct": 30}])
        self.assertEqual(result["units"], 1000)
        self.assertEqual(result["amount"], 0.00002)
        with self.assertRaisesRegex(ValueError, "disclosed ratio"):
            fund_totals(text, 2, [{"units": 300, "ratio_pct": 31}])
        with self.assertRaisesRegex(ValueError, "reconcile"):
            fund_totals(text, 3, [])
        with self.assertRaisesRegex(ValueError, "exceed"):
            fund_totals(text, 2, [{"units": 1001}])

    def test_ETF_total_includes_unlisted_units_but_disclosed_ratio_uses_listed_units(self):
        text = "报告期末基金份额总额1,000.00份 期末基金资产净值2,000.00 期末基金总份额包含场外份额100份"
        result = fund_totals(text, 2, [{"units": 300, "ratio_pct": 33.33}])
        self.assertEqual(result["units"], 1000)
        self.assertEqual(result["listedUnits"], 900)
        self.assertEqual(result["unlistedUnits"], 100)

    def test_integer_units_are_not_joined_to_next_page_number(self):
        text = "报告期末基金份额总额1,000份 本报告期期末基金份额总额1,00042 期末基金资产净值2,000.00"
        self.assertEqual(fund_totals(text, 2, [])["units"], 1000)


if __name__ == "__main__":
    unittest.main()
