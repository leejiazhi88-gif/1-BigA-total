import unittest

from fetch_large_money_sentiment_data import aggregate_blocks, apply_adjustments, checked_block_amount, replace_block_series


class BlockTradeTests(unittest.TestCase):
    def row(self, code="600000.SH", price=10, vol=100, buyer="机构专用", seller="营业部"):
        return {"ts_code": code, "trade_date": "20200918", "price": price, "vol": vol,
                "amount": price * vol, "buyer": buyer, "seller": seller}

    def test_bonds_funds_b_shares_and_beijing_do_not_enter_sh_sz_a_share_totals(self):
        stock = self.row()
        other = [self.row(code, price=100, vol=2100000) for code in
                 ("112962.SZ", "510300.SH", "200002.SZ", "900901.SH", "430001.BJ")]
        weeks, audit = aggregate_blocks([stock, *other], {"600000.SH": {"list_date": "19900101"}})
        self.assertEqual(weeks["2020-W38"]["amount"], 0.1)
        self.assertEqual(weeks["2020-W38"]["instNet"], 0.1)
        self.assertEqual(audit["excludedNonShSzAShareRows"], 5)
        self.assertEqual(audit["validationErrors"], [])

    def test_large_real_stock_trades_and_formerly_listed_stocks_are_retained(self):
        rows = [self.row(vol=1000000), self.row("000001.SZ", buyer="营业部", seller="机构专用")]
        stocks = {"600000.SH": {"list_date": "19900101", "delist_date": "20210101"},
                  "000001.SZ": {"list_date": "19900101"}}
        weeks, audit = aggregate_blocks(rows, stocks)
        self.assertEqual(weeks["2020-W38"]["amount"], 1000.1)
        self.assertEqual(weeks["2020-W38"]["instNet"], 999.9)
        self.assertEqual(audit["includedRows"], 2)
        self.assertEqual(audit["validationErrors"], [])

    def test_institution_to_institution_trades_have_zero_net_but_count_in_gross(self):
        row = self.row(seller="机构专用")
        weeks, _ = aggregate_blocks([row, row], {"600000.SH": {"list_date": "19900101"}})
        # Identical published trades can be separate executions; do not deduplicate them by amounts/seats.
        self.assertEqual(weeks["2020-W38"]["amount"], 0.2)
        self.assertEqual(weeks["2020-W38"]["instNet"], 0)

    def test_missing_fields_unit_errors_and_unverified_stock_identity_are_flagged(self):
        bad = self.row()
        bad["amount"] *= 10000
        with self.assertRaisesRegex(ValueError, "mismatch"):
            checked_block_amount(bad)
        with self.assertRaisesRegex(ValueError, "Invalid"):
            checked_block_amount({**self.row(), "vol": None})
        weeks, audit = aggregate_blocks([bad, self.row("000001.SZ")], {"600000.SH": {"list_date": "19900101"}})
        self.assertEqual(len(weeks), 0)
        self.assertEqual(len(audit["validationErrors"]), 2)

    def test_block_repair_keeps_other_metrics_and_uses_actual_trade_date(self):
        data = {"series": [{"date": "2020-09-19", "blockAmount": 3609139.82,
                            "institutionBlockNet": -257554.65, "holderNetShares": -19.4701,
                            "northDate": "2020-09-18", "northMoney": 12}]}
        weeks = {"2020-W38": {"dates": ["20200918"], "amount": 162.78, "instNet": -13.91}}
        row = replace_block_series(data, weeks)[0]
        self.assertEqual(row["blockDate"], "2020-09-18")
        self.assertEqual(row["institutionBlockNet"], -13.91)
        self.assertEqual(row["holderNetShares"], -19.4701)
        self.assertEqual(row["northMoney"], 12)
        self.assertEqual(data["series"][0]["institutionBlockNet"], -257554.65)

    def test_combined_rounding_error_does_not_reject_small_high_price_trades(self):
        row = self.row(price=354.84, vol=0.57)
        row["amount"] = 200.48
        self.assertEqual(checked_block_amount(row), 0.020048)

    def test_documented_adjustment_requires_the_entire_original_record(self):
        original = self.row()
        adjustments = [{"original": original, "replacement": {"vol": 101}}]
        rows, applied = apply_adjustments([original, {**original, "seller": "另一营业部"}], adjustments)
        self.assertEqual(rows[0]["vol"], 101)
        self.assertEqual(rows[1]["vol"], 100)
        self.assertEqual(len(applied), 1)
        self.assertEqual(original["vol"], 100)


if __name__ == "__main__":
    unittest.main()
