"""Comparable monthly balances and year-on-year growth for TSF and M2."""
import calendar
import argparse
import json
import math
from datetime import datetime
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


SOCIAL_2017_SOURCE = "https://news.cnstock.com/news,bwkx-201801-4175336.htm"


def social_comparability(row):
    if row["date"].startswith("2017-"):
        row["yoy"] = None
        row["yoyStatus"] = "incompatible_balance_scopes"
        if row["date"] == "2017-12-31" and row.get("value") is not None:
            row.update(yoy=12.0, yoyStatus="official_comparable", yoySource=SOCIAL_2017_SOURCE)
    return row


def repair_social_comparability(macro):
    for row in macro["social"]["series"]:
        social_comparability(row)
    macro["social"]["meta"]["balanceBreaks"] = [
        {"date": "2017-01-01", "label": "历史统计口径变化", "source": SOCIAL_2017_SOURCE}
    ]
    macro["meta"]["socialYoy"] = (
        "2017: no growth from incompatible balances; verified official comparable December growth 12%; "
        "other periods: exact same-month balance ratio, not official comparable growth"
    )
    return macro


def number(value, label, positive=False):
    if value in (None, "", "--"):
        return None
    result = float(value)
    if not math.isfinite(result) or (positive and result <= 0):
        raise ValueError(f"Invalid macro observation: {label}")
    return result


def monthly_rows(rows, fields, end):
    result = {}
    for row in rows:
        month = row["month"]
        datetime.strptime(month, "%Y%m")
        if month > end[:6]:
            raise ValueError(f"Macro observation after cutoff: {month}")
        item = {key: number(row.get(key), month + ":" + key, key in ("m2", "stk_endval")) for key in fields}
        if month in result and result[month] != item:
            raise ValueError(f"Conflicting macro observations: {month}")
        result[month] = item
    return result


def normalize_macro(money, financing, end, previous=None):
    m2 = monthly_rows(money, ("m2", "m2_yoy"), end)
    social = monthly_rows(financing, ("stk_endval",), end)
    result = {"meta": {"requestedEnd": end, "unit": "万亿元 / %",
                       "sources": {"m2": "Tushare cn_m: m2 (亿元) / 10000; m2_yoy (%)",
                                   "social": "Tushare sf_month: stk_endval (万亿元)"},
                       "socialYoy": "(current balance / balance in the same month last year - 1) * 100; missing base stays null"}}
    for key, source, field, floor in (("m2", m2, "m2", "199112"), ("social", social, "stk_endval", "200612")):
        available = sorted(m for m, row in source.items() if m >= floor and row[field] is not None)
        if not available:
            raise ValueError(f"No {key} balances returned")
        start, last = available[0], available[-1]
        series = []
        month = start
        while month <= last:
            year, mon = int(month[:4]), int(month[4:])
            row = source.get(month, {})
            raw = row.get(field)
            base = source.get(f"{year-1:04d}{mon:02d}", {}).get(field)
            value = round(raw / 10000, 8) if raw is not None and key == "m2" else raw
            yoy = row.get("m2_yoy") if key == "m2" else ((raw / base - 1) * 100 if raw is not None and base is not None else None)
            # A percentage without the corresponding balance cannot be interpreted as a full observation.
            if raw is None:
                yoy = None
            series.append({"date": f"{year:04d}-{mon:02d}-{calendar.monthrange(year, mon)[1]:02d}",
                           "value": value, "yoy": round(yoy, 4) if yoy is not None else None})
            if key == "social":
                social_comparability(series[-1])
            month = f"{year + (mon == 12):04d}{mon % 12 + 1:02d}"
        if series[-1]["date"].replace("-", "") > end:
            raise ValueError(f"Unexpected unfinished monthly balance: {key}")
        old = {r["date"]: r for r in (previous or {}).get(key, {}).get("series", []) if r["date"].replace("-", "") <= end}
        current = {r["date"]: r for r in series}
        for date, row in old.items():
            for field in ("value", "yoy"):
                correcting_invalid_growth = (key == "social" and field == "yoy"
                    and current.get(date, {}).get("yoyStatus") == "incompatible_balance_scopes"
                    and not row.get("yoySource"))
                if row.get(field) is not None and current.get(date, {}).get(field) is None and not correcting_invalid_growth:
                    raise ValueError(f"Macro refresh lost published observation: {key} {date}")
        result[key] = {"meta": {"start": series[0]["date"], "end": series[-1]["date"]}, "series": series}
    return repair_social_comparability(result)


def fetch_macro(token, end=END_DATE, previous=None):
    money = call_api(token, "cn_m", {"start_m": "199012", "end_m": end[:6]}, "month,m2,m2_yoy")
    financing = call_api(token, "sf_month", {"start_m": "200501", "end_m": end[:6]}, "month,stk_endval")
    return normalize_macro(money, financing, end, previous)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repair-comparability", action="store_true",
                        help="Repair known scope discontinuities in the existing cache without API calls")
    args = parser.parse_args()
    path = Path(__file__).resolve().parent / "official_sentiment_data.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["macro"] = (repair_social_comparability(data["macro"]) if args.repair_comparability
                     else fetch_macro(get_token(), previous=data.get("macro")))
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({key: {"meta": data["macro"][key]["meta"], "last": data["macro"][key]["series"][-1]}
                      for key in ("social", "m2")}, ensure_ascii=False))
