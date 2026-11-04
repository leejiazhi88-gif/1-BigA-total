import unittest
from unittest.mock import patch

from reverse_repo_rates import BASE, fetch_reverse_repo_history, parse_operation


def announcement(tenor="7天", rate="1.40%", direction="逆回购", rate_first=True):
    headers = ["期限", "操作利率", "中标量"] if rate_first else ["期限", "交易量", "中标利率"]
    values = [tenor, rate, "150亿元"] if rate_first else [tenor, "150亿元", rate]
    return '<div id="zoom"><p>' + direction + '操作情况</p><table><tr>' + ''.join(
        '<td>' + h + '</td>' for h in headers) + '</tr><tr>' + ''.join(
        '<td><span>' + v + '</span></td>' for v in values) + '</tr></table></div>'


class ReverseRepoTests(unittest.TestCase):
    def test_new_and_old_table_column_order(self):
        for rate_first in (True, False):
            row = parse_operation(announcement(rate_first=rate_first), "2026-10-30", "source")
            self.assertEqual(row, {"date": "2026-10-30", "reverseRepo7d": 1.4, "sourceUrl": "source"})

    def test_other_tenors_directions_and_missing_days_are_not_quotes(self):
        for tenor in ("隔夜", "14天", "28天", "91天"):
            self.assertIsNone(parse_operation(announcement(tenor=tenor), "2026-11-03", "source"))
        self.assertIsNone(parse_operation(announcement(direction="正回购"), "2014-01-01", "source"))
        self.assertIsNone(parse_operation(announcement(direction="买断式逆回购"), "2026-01-01", "source"))
        zero = '<div id="zoom">7天期逆回购操作量为零<table><tr><td>期限</td><td>中标量</td></tr><tr><td>7天</td><td>0亿元</td></tr></table></div>'
        self.assertIsNone(parse_operation(zero, "2026-10-23", "source"))

    def test_nested_inline_rate_text_and_multiple_operation_directions(self):
        html = announcement().replace("1.40%", "<span>1.</span><span>40</span><span>%</span>")
        self.assertEqual(parse_operation(html, "2026-10-30", "source")["reverseRepo7d"], 1.4)
        both = announcement(direction="正回购", rate="9%")[:-6] + announcement()[15:]
        self.assertEqual(parse_operation(both, "2026-10-30", "source")["reverseRepo7d"], 1.4)
        nested = '<div id="zoom"><table><tr><td>' + announcement()[15:-6] + '</td></tr></table></div>'
        self.assertEqual(parse_operation(nested, "2026-10-30", "source")["reverseRepo7d"], 1.4)

    def test_invalid_conflicting_and_unparsed_announcements_fail(self):
        for html in (announcement(rate="NaN"), announcement(rate="-1%"),
                     '<div id="zoom">开展7天期逆回购，数据在图片内</div>', '<html>blocked</html>',
                     announcement()[:-6] + announcement(rate="1.5%")[15:]):
            with self.assertRaises(ValueError):
                parse_operation(html, "2026-10-30", "source")

    def test_incremental_refresh_preserves_old_quotes_and_excludes_future(self):
        rows = [("2026-11-04", "future"), ("2026-10-30", "new"), ("2026-09-01", "old")]
        listing = ''.join(f'<a istitle="true" href="{name}">公告</a><span>{date}</span>' for date, name in rows)
        previous = {"series": [{"date": "2015-06-28", "reverseRepo7d": 2.5, "sourceUrl": "old"}]}
        # The old observation advances the lower bound, so the next page ends the archive.
        older = '<a istitle="true" href="earlier">公告</a><span>2015-01-01</span>'
        def read(url, cached=False):
            if url == BASE + "index.html":
                return listing
            if url == BASE + "17081-2.html":
                return older
            return announcement()
        with patch("reverse_repo_rates.read_url", side_effect=read):
            with self.assertRaises(ValueError, msg="previous observation cannot disappear"):
                fetch_reverse_repo_history("20261103", previous)
        previous["series"].append({"date": "2026-10-30", "reverseRepo7d": 1.4, "sourceUrl": BASE + "new"})
        with patch("reverse_repo_rates.read_url", side_effect=read) as source:
            result = fetch_reverse_repo_history("20261103", previous)
        self.assertEqual([r["date"] for r in result["series"]], ["2015-06-28", "2026-10-30"])
        self.assertEqual(result["meta"]["checkedThrough"], "2026-11-03")
        self.assertFalse(any(c.args[0].endswith("future") for c in source.call_args_list))


if __name__ == "__main__":
    unittest.main()
