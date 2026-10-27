"""Build quarter-end total A-share market capitalization, independent of holdings."""

import hashlib
import json
import math
from datetime import datetime
from zoneinfo import ZoneInfo

from fetch_national_team_stock_history import ROOT, read, save
from tushare_client import call_api_pages, get_token

CACHE = ROOT / ".tools" / "a-share-market-cap"
OUTPUT = ROOT / "work" / "a_share_market_cap.json"


def cached_api(token, api, params, fields):
    key = hashlib.sha256(json.dumps([api, params, fields], sort_keys=True).encode()).hexdigest()
    target = CACHE / f"{api}-{key}.json"
    if target.exists():
        return read(target)["rows"]
    rows = call_api_pages(token, api, params, fields, 2000)
    save(target, {"api": api, "params": params, "fields": fields, "rows": rows})
    return rows


def indexed(rows, date):
    result = {}
    for row in rows:
        if row["trade_date"] != date or row["ts_code"] in result:
            raise ValueError("Mixed dates or duplicate market rows")
        result[row["ts_code"]] = row
    return result


def positive(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def board(row, count_field, scale=1):
    if not row or not positive(row.get("total_mv")) or not positive(row.get(count_field)):
        raise ValueError("Missing market capitalization or company count")
    return {"code": row["ts_code"], "amount": row["total_mv"] / scale, "count": row[count_field]}


def build_period(period, date, sh_rows, sz_rows, beijing):
    if date > period or date[:6] != period[:6]:
        raise ValueError("Market date must be at or before period end in the same month")
    sh, sz = indexed(sh_rows, date), indexed(sz_rows, date)
    sh_codes = ["SH_A"] + (["SH_STAR"] if date >= "20190722" else [])
    sh_parts = [board(sh.get(code), "com_count") for code in sh_codes]
    sz_codes = ["主板A股", "创业板A股" if "创业板A股" in sz else "创业板"]
    if date < "20210406":
        sz_codes.append("中小板")
    sz_parts = [board(sz.get(code), "count", 1e8) for code in sz_codes]
    for rows, parts, total_code, b_code, scale in [
        (sh, sh_parts, "SH_MARKET", "SH_B", 1),
        (sz, sz_parts, "股票", "主板B股", 1e8),
    ]:
        if total_code not in rows:
            if total_code == "SH_MARKET" and date < "20190722":
                continue
            raise ValueError("Missing exchange total")
        if not positive(rows[total_code].get("total_mv")) or not positive(rows.get(b_code, {}).get("total_mv")):
            raise ValueError("Missing market total or B-share cross-check")
        expected = (rows[total_code]["total_mv"] - rows[b_code]["total_mv"]) / scale
        if abs(sum(r["amount"] for r in parts) - expected) > 0.1:
            raise ValueError(f"A-share board sum does not match exchange total minus B shares: {date}")
    if date < beijing["marketOpened"]:
        bj = {"amount": 0, "count": 0, "status": "not_open"}
    else:
        matches = [row for row in beijing["rows"] if row["trade_date"] == date]
        if len(matches) != 1 or not positive(matches[0].get("amount")) or not positive(matches[0].get("count")):
            raise ValueError("Missing official Beijing market total: " + date)
        bj = {**matches[0], "source": beijing["source"]}
    exchanges = {
        "SH": {"amount": sum(r["amount"] for r in sh_parts), "count": sum(r["count"] for r in sh_parts),
               "boards": sh_parts, "source": "Tushare daily_info (亿元)"},
        "SZ": {"amount": sum(r["amount"] for r in sz_parts), "count": sum(r["count"] for r in sz_parts),
               "boards": sz_parts, "source": "Tushare sz_daily_info (元 / 1e8)"},
        "BJ": bj,
    }
    return {"period": period, "date": date, "amount": sum(r["amount"] for r in exchanges.values()),
            "count": sum(r["count"] for r in exchanges.values()), "exchanges": exchanges}


def main():
    periods = sorted(read(ROOT / "work" / "holding_denominators.json")["stocks"])
    beijing = read(ROOT / "work" / "bse_market_cap_history.json")
    token = get_token()
    calendar = cached_api(token, "trade_cal", {"exchange": "SSE", "start_date": periods[0], "end_date": periods[-1]},
                          "cal_date,is_open,pretrade_date")
    dates = {r["cal_date"]: r["cal_date"] if r["is_open"] else r["pretrade_date"] for r in calendar}
    result = {}
    for period in periods:
        date = dates[period]
        sh = cached_api(token, "daily_info", {"trade_date": date, "exchange": "SH"}, "trade_date,ts_code,com_count,total_mv")
        sz = cached_api(token, "sz_daily_info", {"trade_date": date}, "trade_date,ts_code,count,total_mv")
        result[period] = build_period(period, date, sh, sz, beijing)
        print(json.dumps({"period": period, "amount": result[period]["amount"], "count": result[period]["count"]}), flush=True)
    save(OUTPUT, {"checkedAt": datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d"),
                  "scope": "All listed A shares on Shanghai, Shenzhen and Beijing exchanges; includes restricted A shares; excludes B/H shares, funds and NEEQ",
                  "unit": "亿元", "failures": [], "periods": result})


if __name__ == "__main__":
    main()
