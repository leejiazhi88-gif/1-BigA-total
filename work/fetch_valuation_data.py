import bisect
import json
import ssl
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "valuation_data.json"
START_YEAR = 2006
END_YEAR = int(END_DATE[:4])


class YieldTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.links = [], [], None, []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag == "td":
            self.cell = []
        elif tag == "a":
            self.links.append(dict(attrs).get("href", ""))

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.cell is not None:
            self.row.append("".join(self.cell).strip())
            self.cell = None
        elif tag == "tr":
            self.rows.append(self.row)


def parse_chinabond_yield(html, date):
    table = YieldTable()
    table.feed(html)
    if "中债国债收益率曲线(到期)" not in html or not any(f"workTime={date}" in link for link in table.links):
        raise ValueError(f"ChinaBond did not return the requested curve/date: {date}")
    values = [float(row[1]) for row in table.rows if len(row) == 2 and row[0] == "10.0y"]
    if len(values) != 1 or not -5 < values[0] < 30:
        raise ValueError(f"Missing or invalid 10-year ChinaBond observation: {date}")
    return values[0]


def chinabond_yield(date):
    iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    params = {"ycDefIds": "2c9081e50a2f9606010a3068cae70001", "zblx": "txy", "workTime": iso,
              "dxbj": "0", "qxlx": "0", "yqqxN": "N", "yqqxK": "K", "wrjxCBFlag": "0", "locale": "zh_CN"}
    request = urllib.request.Request("https://yield.chinabond.com.cn/cbweb-mn/yc/ycDetail?" + urllib.parse.urlencode(params),
                                     data=b"", headers={"User-Agent": "Mozilla/5.0"}, method="POST")
    with urllib.request.urlopen(request, timeout=25, context=ssl._create_unverified_context()) as response:
        return parse_chinabond_yield(response.read().decode("utf-8"), iso)



def fetch_by_year(token, api_name, base_params, fields):
    rows = []
    for year in range(START_YEAR, END_YEAR + 1):
        params = {
            **base_params,
            "start_date": f"{year}0101",
            "end_date": END_DATE if year == END_YEAR else f"{year}1231",
        }
        rows.extend(call_api(token, api_name, params, fields))
    unique = {row["trade_date"]: row for row in rows}
    return [unique[date] for date in sorted(unique)]


def last_by_week(rows):
    result = []
    current_key = None
    for row in rows:
        date = datetime.strptime(row["trade_date"], "%Y%m%d")
        key = (date.isocalendar().year, date.isocalendar().week)
        if key != current_key:
            result.append(row)
            current_key = key
        else:
            result[-1] = row
    return result


def percentile(values, value):
    return bisect.bisect_right(values, value) / len(values) * 100


def build_index_series(rows, bond_dates, bond_by_date):
    valid = [row for row in rows if row.get("pb") and row.get("pe_ttm", 0) > 0]
    pb_values = sorted(float(row["pb"]) for row in valid)
    result = []
    for row in last_by_week(valid):
        date = row["trade_date"]
        bond_yield = bond_by_date.get(date)
        pe = float(row["pe_ttm"])
        pb = float(row["pb"])
        result.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "pb": round(pb, 4),
                "pbPercentile": round(percentile(pb_values, pb), 4),
                "bond10y": round(bond_yield, 4) if bond_yield is not None else None,
                "equityBondSpread": round(100 / pe - bond_yield, 4) if bond_yield is not None else None,
            }
        )
    return result


def main():
    token = get_token()
    fields = "ts_code,trade_date,pe_ttm,pb"
    sh_rows = fetch_by_year(
        token, "index_dailybasic", {"ts_code": "000001.SH"}, fields
    )
    sz_rows = fetch_by_year(
        token, "index_dailybasic", {"ts_code": "399001.SZ"}, fields
    )
    bond_status = "refreshed"
    bond_source = "Tushare yc_cb"
    missing_bond_dates = []
    try:
        bond_rows = fetch_by_year(
            token, "yc_cb", {"ts_code": "1001.CB", "curve_type": "0", "curve_term": 10},
            "trade_date,yield",
        )
        bond_by_date = {row["trade_date"]: float(row["yield"]) for row in bond_rows if row.get("yield") is not None}
    except RuntimeError:
        cached = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"sh": [], "meta": {}}
        bond_by_date = {row["date"].replace("-", ""): row["bond10y"]
                        for row in cached["sh"] if row.get("bond10y") is not None and row["date"].replace("-", "") <= END_DATE}
        bond_source = "ChinaBond official public 10-year maturity yield; dated cache for earlier observations"
        last_cached = max(bond_by_date, default="20060101")
        retry_dates = set(cached.get("meta", {}).get("missingBondDates", []))
        print("Tushare bond access unavailable; refreshing from the official ChinaBond curve.", flush=True)
        for row in last_by_week(sh_rows):
            date = row["trade_date"]
            if (date >= last_cached or date in retry_dates) and date not in bond_by_date:
                try:
                    bond_by_date[date] = chinabond_yield(date)
                except (ValueError, OSError) as source_error:
                    missing_bond_dates.append(date)
                    print(f"ChinaBond {date}: {source_error}", flush=True)
        bond_status = "partial" if missing_bond_dates else "refreshed"
    bond_dates = sorted(bond_by_date)
    result = {
        "meta": {
            "start": f"{START_YEAR}-01-01",
            "end": min(sh_rows[-1]["trade_date"], sz_rows[-1]["trade_date"]),
            "bondEnd": bond_dates[-1] if bond_dates else None,
            "bondStatus": bond_status,
            "requestedEnd": END_DATE,
            "bondSource": bond_source,
            "bondSourceUrl": "https://yield.chinabond.com.cn/cbweb-mn/yield_main?locale=zh_CN",
            "missingBondDates": missing_bond_dates,
            "bond": "中债国债收益率曲线 10年期到期收益率",
            "spread": "100 / PE(TTM) - 10年期国债收益率",
        },
        "sh": build_index_series(sh_rows, bond_dates, bond_by_date),
        "sz": build_index_series(sz_rows, bond_dates, bond_by_date),
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "sh_points": len(result["sh"]),
                "sz_points": len(result["sz"]),
                "bond_days": len(bond_dates),
                "latest_sh": result["sh"][-1],
                "latest_sz": result["sz"][-1],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
