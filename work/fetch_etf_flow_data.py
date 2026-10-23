import json
import math
from datetime import datetime, timedelta
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


OUTPUT = Path(__file__).resolve().parent / "etf_flow_data.json"
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


def daily_flow(current, previous):
    if not current or not previous:
        return None, "missing_share"
    shares, prev_shares, nav = current.get("total_share"), previous.get("total_share"), current.get("nav")
    if not all(finite(value) for value in (shares, prev_shares, nav)) or min(shares, prev_shares, nav) <= 0:
        return None, "missing_share_or_nav"
    prev_nav = previous.get("nav")
    # Opposing large share/NAV moves can be a split or conversion, not subscriptions.
    if finite(prev_nav) and prev_nav > 0:
        share_ratio, nav_ratio = shares / prev_shares, nav / prev_nav
        if (share_ratio > 1.5 and nav_ratio < 0.75) or (share_ratio < 0.67 and nav_ratio > 1.33):
            return None, "possible_split"
    return (shares - prev_shares) * nav / 10000, None


def build_series(calendar_rows, raw_by_code, pool=ETF_POOL, window=90):
    calendar_rows = sorted(calendar_rows, key=lambda row: row["cal_date"])[-window:]
    series = []
    for day in calendar_rows:
        date, previous_date = day["cal_date"], day["pretrade_date"]
        flows, issues = {}, {}
        for etf in pool:
            code = etf["ts_code"]
            rows = raw_by_code.get(code, {})
            value, issue = daily_flow(rows.get(date), rows.get(previous_date))
            flows[code] = round(value, 6) if value is not None else None
            if issue:
                issues[code] = issue
        complete = all(value is not None for value in flows.values())
        series.append({"date": iso_date(date), "flows": flows,
                       "total": round(sum(flows.values()), 6) if complete else None,
                       "coverage": len(pool) - len(issues), "issues": issues})
    return series


def main():
    token = get_token()
    start = (datetime.strptime(END_DATE, "%Y%m%d") - timedelta(days=220)).strftime("%Y%m%d")
    calendar_rows = call_api(token, "trade_cal", {
        "exchange": "SSE", "start_date": start, "end_date": END_DATE, "is_open": "1",
    }, "cal_date,pretrade_date")
    if len(calendar_rows) < 91:
        raise RuntimeError("Insufficient trading-calendar history; retaining previous ETF flows.")
    calendar_rows.sort(key=lambda row: row["cal_date"])
    raw_by_code = {}
    for etf in ETF_POOL:
        rows = call_api(token, "etf_share_size", {
            "ts_code": etf["ts_code"], "start_date": start, "end_date": END_DATE,
        }, "trade_date,ts_code,total_share,total_size,nav,close")
        if not rows:
            raise RuntimeError(f"No ETF share data for {etf['ts_code']}; retaining previous dataset.")
        raw_by_code[etf["ts_code"]] = {row["trade_date"]: row for row in rows if row["trade_date"] <= END_DATE}
    last_reported = max(date for rows in raw_by_code.values() for date in rows)
    published_calendar = [day for day in calendar_rows if day["cal_date"] <= last_reported]
    series = build_series(published_calendar, raw_by_code)
    complete_dates = [row["date"] for row in series if row["total"] is not None]
    if not complete_dates:
        raise RuntimeError("No complete ETF daily observations returned.")
    result = {
        "meta": {"updated": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
                 "start": series[0]["date"], "end": complete_dates[-1], "windowEnd": series[-1]["date"],
                 "frequency": "daily", "window": 90, "completeDays": len(complete_dates),
                 "unit": "亿元", "source": "Tushare etf_share_size + trade_cal",
                 "sourceUrl": "https://tushare.pro/document/2?doc_id=408",
                 "method": "(total_share[t] - total_share[previous trading day]) * nav[t] / 10000",
                 "shareUnit": "万份", "nationalTeamIdentified": False,
                 "limitations": ["ETF subscriptions/redemptions include all investors and in-kind baskets",
                                 "Not cash inflows or confirmed national-team purchases",
                                 "Missing trading-day observations and possible splits remain null"]},
        "etfs": ETF_POOL, "series": series,
        "observations": {code: [rows[date] for date in sorted(rows)] for code, rows in raw_by_code.items()},
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "meta": result["meta"], "latest": series[-1]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
