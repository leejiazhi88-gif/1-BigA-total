import unittest

from macro_money_data import normalize_macro


class MacroMoneyTests(unittest.TestCase):
    def setUp(self):
        self.money = [{"month": "202509", "m2": 1000000, "m2_yoy": 7.0},
                      {"month": "202609", "m2": 1100000, "m2_yoy": 9.5}]
        self.social = [{"month": "202509", "stk_endval": 100},
                       {"month": "202609", "stk_endval": 110}]

    def test_units_and_published_m2_growth(self):
        d = normalize_macro(self.money, self.social, "20261103")
        self.assertEqual(d["m2"]["series"][-1]["value"], 110)
        self.assertEqual(d["m2"]["series"][-1]["yoy"], 9.5, "keep comparable published growth")
        self.assertEqual(d["social"]["series"][-1]["value"], 110)
        self.assertEqual(d["social"]["series"][-1]["yoy"], 10)

    def test_exact_calendar_base_missing_months_and_leap_year(self):
        social = [{"month": "202402", "stk_endval": 100},
                  {"month": "202503", "stk_endval": 105}, {"month": "202602", "stk_endval": 110}]
        d = normalize_macro(self.money, social, "20261103")["social"]["series"]
        self.assertEqual(d[0]["date"], "2024-02-29")
        self.assertIsNone(d[1]["value"])
        self.assertIsNone(d[-1]["yoy"], "do not substitute an adjacent month for missing 2025-02")
        self.assertEqual(d[-1]["date"], "2026-02-28")

    def test_negative_growth_and_early_unavailable_balances(self):
        self.social[-1]["stk_endval"] = 90
        self.social.insert(0, {"month": "200601", "stk_endval": None})
        rows = normalize_macro(self.money, self.social, "20261103")["social"]["series"]
        self.assertEqual(rows[0]["date"], "2025-09-30")
        self.assertEqual(rows[-1]["yoy"], -10)

    def test_invalid_conflicting_and_future_data_fail(self):
        for money in ([{**self.money[-1], "m2": float("nan")}],
                      [{**self.money[-1], "m2": 0}], [{**self.money[-1], "month": "202612"}],
                      self.money + [{**self.money[-1], "m2": 1200000}]):
            with self.assertRaises(ValueError):
                normalize_macro(money, self.social, "20261103")

    def test_refresh_cannot_erase_existing_values(self):
        old = normalize_macro(self.money, self.social, "20261103")
        self.social[-1]["stk_endval"] = None
        with self.assertRaises(ValueError):
            normalize_macro(self.money, self.social, "20261103", old)


if __name__ == "__main__":
    unittest.main()
