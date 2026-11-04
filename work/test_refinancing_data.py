import unittest

from fetch_refinancing_data import fetch_complete
from refinancing_metrics import normalize_issuances, aggregate_refinancing


class RefinancingTests(unittest.TestCase):
    def test_completed_dates_units_exchanges_and_ipo_exclusion(self):
        additional = [
            dict(SECUCODE="300001.SZ", FINANCE_CODE="1", ISSUE_DATE="2026-01-05", ISSUE_LISTING_DATE="2026-02-01",
                 TOTAL_RAISE_FUNDS=200000000, ISSUE_NUM=10000000, ISSUE_PRICE=20),
            dict(SECUCODE="688001.SH", FINANCE_CODE="2", ISSUE_DATE="2026-01-06", ISSUE_NUM=5000000, ISSUE_PRICE=20),
            dict(SECUCODE="920001.BJ", FINANCE_CODE="3", ISSUE_DATE="2026-01-07", TOTAL_RAISE_FUNDS=500000000),
            dict(SECUCODE="300001.SZ", FINANCE_CODE="4", ISSUE_DATE="2026-02-28", TOTAL_RAISE_FUNDS=500000000),
            dict(SECUCODE="688002.SH", FINANCE_CODE="6", ISSUE_DATE="2026-01-10", TOTAL_RAISE_FUNDS=600000000),
            dict(SECUCODE="300001.SZ", FINANCE_CODE="7", ISSUE_DATE="2026-02-02", TOTAL_RAISE_FUNDS=500000000),
        ]
        rights = [dict(SECUCODE="300001.SZ", FINANCE_CODE="5", PAY_END_DATE="2026-01-31",
                       LISTING_DATE="2026-02-20", TOTAL_RAISE_FUNDS=300000000)]
        records, excluded = normalize_issuances(additional, rights,
            {"300001.SZ": "20091030", "688001.SH": "20190722", "688002.SH": "20260115"}, "2026-02-03")
        self.assertEqual(len(records), 4)
        self.assertEqual({r["id"] for r in excluded}, {"3", "6"})
        self.assertEqual(records[1]["amountSource"], "ISSUE_NUM * ISSUE_PRICE")
        data = aggregate_refinancing(records, "2026-02", "2026-01")
        self.assertEqual(len(data["series"]), 1)
        self.assertEqual(data["series"][0]["refinanceFunds"], 6)
        self.assertEqual(data["markets"]["sh"][0]["refinanceFunds"], 1)
        self.assertEqual(data["markets"]["sz"][0]["refinanceFunds"], 5)
        self.assertEqual(data["series"][0]["rightsFunds"], 3)

    def test_missing_amount_invalidates_only_affected_market_and_total(self):
        records, _ = normalize_issuances([
            dict(SECUCODE="300001.SZ", FINANCE_CODE="1", ISSUE_DATE="2026-01-05"),
            dict(SECUCODE="688001.SH", FINANCE_CODE="2", ISSUE_DATE="2026-01-06", TOTAL_RAISE_FUNDS=100000000)
        ], [], {"300001.SZ": "20091030", "688001.SH": "20190722"}, "2026-03-01")
        data = aggregate_refinancing(records, "2026-03", "2026-01")
        self.assertIsNone(data["series"][0]["refinanceFunds"])
        self.assertIsNone(data["markets"]["sz"][0]["refinanceFunds"])
        self.assertEqual(data["markets"]["sh"][0]["refinanceFunds"], 1)
        self.assertEqual(data["series"][0]["coverage"]["missingAmounts"], 1)
        self.assertEqual(data["series"][1]["refinanceFunds"], 0)

    def test_missing_listing_and_duplicate_events_reject_publication(self):
        row = dict(SECUCODE="300001.SZ", FINANCE_CODE="1", ISSUE_DATE="2026-01-05", TOTAL_RAISE_FUNDS=100)
        with self.assertRaisesRegex(ValueError, "Initial listing"):
            normalize_issuances([row], [], {}, "2026-02-01")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            normalize_issuances([row, row], [], {"300001.SZ": "20091030"}, "2026-02-01")

    def test_complete_stable_unique_pagination(self):
        def request(*args):
            return {"count": 3, "pages": 2, "data": [{"FINANCE_CODE": "1"}, {"FINANCE_CODE": "2"}]
                    if args[-1] == 1 else [{"FINANCE_CODE": "3"}]}
        self.assertEqual(len(fetch_complete("report", "date", "columns", "2008-01-01", request)), 3)
        for mode in ("duplicate", "short", "changed"):
            def bad(*args):
                result = request(*args)
                if args[-1] == 2:
                    if mode == "duplicate": result["data"] = [{"FINANCE_CODE": "1"}]
                    if mode == "short": result["data"] = []
                    if mode == "changed": result["count"] = 4
                return result
            with self.assertRaises(ValueError):
                fetch_complete("report", "date", "columns", "2008-01-01", bad)


if __name__ == "__main__":
    unittest.main()
