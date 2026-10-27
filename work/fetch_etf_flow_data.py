import argparse
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


OUTPUT = Path(__file__).resolve().parent / "etf_flow_data.json"
CACHE = OUTPUT.parent.parent / ".tools" / "etf-flow-history"
START_DATE = "20150101"
FETCH_START = "20141201"
FIELDS = "trade_date,ts_code,total_share,total_size,nav,close"
ADJUSTMENTS = json.loads((OUTPUT.parent / "etf_flow_adjustments.json").read_text(encoding="utf-8"))
ETF_POOL = [
    {"ts_code": "510300.SH", "name": "华泰柏瑞沪深300", "group": "沪深300"},
    {"ts_code": "510310.SH", "name": "易方达沪深300", "group": "沪深300"},
    {"ts_code": "510330.SH", "name": "华夏沪深300", "group": "沪深300"},
    {"ts_code": "159919.SZ", "name": "嘉实沪深300", "group": "沪深300"},
    {"ts_code": "510050.SH", "name": "华夏上证50", "group": "上证50"},
    {"ts_code": "510500.SH", "name": "南方中证500", "group": "中证500"},
    {"ts_code": "512100.SH", "name": "南方中证1000", "group": "中证1000"},
    {"ts_code": "159915.SZ", "name": "易方达创业板", "group": "创业板"},
    {"ts_code": "588000.SH", "name": "华夏科创50", "group": "科创50"},
]


def iso_date(date):
    return f"{date[:4]}-{date[4:6]}-{date[6:]}"


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def daily_flow(current, previous, factor=1):
    if not current or not previous:
        return None, "missing_share"
    shares, prev_shares, nav = current.get("total_share"), previous.get("total_share"), current.get("nav")
    if not all(finite(value) for value in (shares, prev_shares, nav)) or min(shares, prev_shares, nav) <= 0:
        return None, "missing_share_or_nav"
    if not finite(factor) or factor <= 0:
        raise ValueError("Invalid ETF conversion factor")
    prev_shares *= factor
    prev_nav = previous.get("nav")
    # Opposing large share/NAV moves can be a split or conversion, not subscriptions.
    if finite(prev_nav) and prev_nav > 0:
        share_ratio, nav_ratio = shares / prev_shares, nav / prev_nav
        nav_ratio *= factor
        if (share_ratio > 1.5 and nav_ratio < 0.75) or (share_ratio < 0.67 and nav_ratio > 1.33):
            return None, "possible_split"
    return (shares - prev_shares) * nav / 10000, None


def conversion_factor(adjustment):
    if "beforeUnits" in adjustment:
        if adjustment["beforeUnits"] <= 0 or adjustment["afterUnits"] <= 0:
            raise ValueError("Invalid reported ETF conversion totals")
        factor = adjustment["afterUnits"] / adjustment["beforeUnits"]
        if abs(factor - adjustment["factor"]) > 0.000005:
            raise ValueError("ETF conversion totals disagree with disclosed factor")
        return factor
    return adjustment.get("factor", 1)


def build_series(calendar_rows, raw_by_code, pool=ETF_POOL, window=None):
    calendar_rows = sorted(calendar_rows, key=lambda row: row["cal_date"])
    if window is not None:
        calendar_rows = calendar_rows[-window:]
    series = []
    for day in calendar_rows:
        date, previous_date = day["cal_date"], day["pretrade_date"]
        flows, issues = {}, {}
        for etf in pool:
            code = etf["ts_code"]
            rows = raw_by_code.get(code, {})
            if date < etf.get("list_date", ""):
                value, issue = None, "not_listed"
            else:
                adjustment = ADJUSTMENTS.get(code + ":" + date, {})
                value, issue = daily_flow(rows.get(date), rows.get(previous_date), conversion_factor(adjustment))
            flows[code] = round(value, 6) if value is not None else None
            if issue:
                issues[code] = issue
        active = [etf["ts_code"] for etf in pool if issues.get(etf["ts_code"]) != "not_listed"]
        complete = bool(active) and all(flows[code] is not None for code in active)
        series.append({"date": iso_date(date), "flows": flows,
                       "total": round(sum(flows[code] for code in active), 6) if complete else None,
                       "coverage": sum(value is not None for value in flows.values()),
                       "eligible": len(active), "issues": issues,
                       "adjusted": [code for code in active if code + ":" + date in ADJUSTMENTS]})
    return series


def cached_api(token, api, params, fields, filename, refresh=False, offline=False):
    target = CACHE / (filename + ".json")
    if target.exists() and (offline or not refresh):
        return json.loads(target.read_text(encoding="utf-8"))
    if offline:
        raise RuntimeError("Missing ETF history cache: " + filename)
    rows = call_api(token, api, params, fields)
    if len(rows) >= 5000:
        raise RuntimeError("Unexpected API limit reached: " + filename)
    CACHE.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return rows


def load_history(token, offline=False):
    pool, raw_by_code = [], {}
    calendar_rows = cached_api(token, "trade_cal", {
        "exchange": "SSE", "start_date": FETCH_START, "end_date": END_DATE, "is_open": "1",
    }, "cal_date,pretrade_date", "calendar-" + END_DATE, refresh=True, offline=offline)
    for etf in ETF_POOL:
        code = etf["ts_code"]
        basic = cached_api(token, "fund_basic", {"ts_code": code},
                           "ts_code,name,found_date,list_date,purc_startdate", "basic-" + code, offline=offline)
        if len(basic) != 1 or not basic[0].get("list_date"):
            raise RuntimeError("Unverified ETF listing date: " + code)
        fund = {**etf, "found_date": basic[0]["found_date"], "list_date": basic[0]["list_date"]}
        pool.append(fund)
        rows_by_date = {}
        for year in range(max(2014, int(fund["list_date"][:4])), int(END_DATE[:4]) + 1):
            start, end = max(FETCH_START, f"{year}0101"), min(END_DATE, f"{year}1231")
            suffix = str(year) if end == f"{year}1231" else f"{year}-{end}"
            rows = cached_api(token, "etf_share_size", {"ts_code": code, "start_date": start, "end_date": end},
                              FIELDS, f"shares-{code}-{suffix}", refresh=year == int(END_DATE[:4]), offline=offline)
            if not rows and any(max(start, fund["list_date"]) <= day["cal_date"] <= end for day in calendar_rows):
                raise RuntimeError("Empty ETF history for an active year: " + code + " " + str(year))
            for row in rows:
                date = row["trade_date"]
                if row["ts_code"] != code or not start <= date <= end:
                    raise RuntimeError("Unexpected ETF source date or code: " + code)
                if date in rows_by_date and row != rows_by_date[date]:
                    raise RuntimeError("Conflicting ETF observations: " + code + " " + date)
                shares, nav, size = row.get("total_share"), row.get("nav"), row.get("total_size")
                if all(finite(x) and x > 0 for x in (shares, nav, size)) and abs(size / shares - nav) > 0.001:
                    raise RuntimeError("ETF share/NAV/size disagreement: " + code + " " + date)
                rows_by_date[date] = row
        if not rows_by_date:
            raise RuntimeError("No ETF history: " + code)
        raw_by_code[code] = rows_by_date
        print(json.dumps({"code": code, "observations": len(rows_by_date), "start": min(rows_by_date),
                          "end": max(rows_by_date), "listDate": fund["list_date"]}), flush=True)
    return calendar_rows, raw_by_code, pool


def build_result(calendar_rows, raw_by_code, pool=ETF_POOL):
    dates = [day["cal_date"] for day in calendar_rows]
    if len(dates) != len(set(dates)) or any(day["pretrade_date"] >= day["cal_date"] for day in calendar_rows):
        raise ValueError("Invalid or duplicate trading-calendar dates")
    last_reported = max(date for rows in raw_by_code.values() for date in rows)
    published_calendar = [day for day in calendar_rows if START_DATE <= day["cal_date"] <= min(last_reported, END_DATE)]
    series = build_series(published_calendar, raw_by_code, pool)
    complete_dates = [row["date"] for row in series if row["total"] is not None]
    if not complete_dates:
        raise RuntimeError("No complete ETF daily observations returned.")
    coverage = {}
    for fund in pool:
        code = fund["ts_code"]
        valid = [r["date"] for r in series if r["flows"][code] is not None]
        issues = [{"date": r["date"], "reason": r["issues"][code]} for r in series
                  if code in r["issues"] and r["issues"][code] != "not_listed"]
        coverage[code] = {"first": valid[0] if valid else None, "last": valid[-1] if valid else None,
                          "validDays": len(valid), "missingDays": len(issues), "issues": issues}
    return {
        "meta": {"updated": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
                 "start": series[0]["date"], "end": complete_dates[-1], "windowEnd": series[-1]["date"],
                 "frequency": "daily", "window": len(series), "completeDays": len(complete_dates),
                 "unit": "亿元", "source": "Tushare etf_share_size + trade_cal",
                 "sourceUrl": "https://tushare.pro/document/2?doc_id=408",
                 "method": "(total_share[t] - total_share[previous trading day] * verified_conversion_factor[t]) * nav[t] / 10000",
                 "shareUnit": "万份", "nationalTeamIdentified": False,
                 "limitations": ["ETF subscriptions/redemptions include all investors and in-kind baskets",
                                 "Not cash inflows or confirmed national-team purchases",
                                 "Each fund joins the sample from its listing date; earlier dates are not applicable",
                                 "Missing trading-day observations and possible splits remain null"]},
        "etfs": pool, "series": series, "coverage": coverage, "adjustments": ADJUSTMENTS,
        "observations": {code: [rows[date] for date in sorted(rows)] for code, rows in raw_by_code.items()},
    }


def main(stage="all"):
    calendar, raw, pool = load_history(None if stage == "export" else get_token(), offline=stage == "export")
    result = build_result(calendar, raw, pool)
    print(json.dumps({"coverage": {code: {**row, "issues": dict(Counter(x["reason"] for x in row["issues"]))}
                                   for code, row in result["coverage"].items()}}, ensure_ascii=False))
    if stage == "collect":
        return
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "meta": result["meta"], "latest": result["series"][-1]}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch daily ETF subscriptions from 2015 using year-sized cached requests")
    parser.add_argument("--stage", choices=("collect", "export", "all"), default="all")
    main(parser.parse_args().stage)
