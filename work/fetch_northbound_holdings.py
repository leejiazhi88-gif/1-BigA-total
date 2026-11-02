"""Quarter-end northbound holdings by Shanghai/Shenzhen, with coverage audit."""
import calendar
import hashlib
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

from tushare_client import END_DATE, call_api_pages, get_token
from fetch_large_money_sentiment_data import sh_sz_a_share
from fetch_a_share_market_cap import indexed, board

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work/northbound_holdings.json"
CACHE = ROOT / ".tools/northbound-holdings"


def cached(token, api, params, fields):
    key = hashlib.sha256(json.dumps([api, params, fields], sort_keys=True).encode()).hexdigest()[:20]
    target = CACHE / f"{api}-{key}.json"
    if target.exists():
        result = json.loads(target.read_text())
        if result["rows"] or result["fetchedAt"][:10] == datetime.now().strftime("%Y-%m-%d"):
            return result["rows"]
    rows = call_api_pages(token, api, params, fields, 2000)
    CACHE.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"api": api, "params": params, "fields": fields,
                                 "fetchedAt": datetime.now().isoformat(), "rows": rows}, ensure_ascii=False))
    return rows


def finite(value):
    if value is None or value == "":
        return None
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Nonfinite source number")
    return value


def aggregate(rows, prices, denominator, market, date):
    if market == "sz" and date < "20161205":
        return {"value": None, "ratio": None, "status": "not_open", "count": 0, "denominator": denominator}
    holdings = {}
    conflicts = []
    for row in rows:
        code = row["ts_code"]
        if not sh_sz_a_share(code) or not code.endswith("." + market.upper()):
            continue
        if row["trade_date"] != date:
            raise ValueError("Mixed holding dates")
        vol = finite(row.get("vol"))
        if vol is None or vol < 0:
            raise ValueError("Missing or negative holding volume")
        if code in holdings and holdings[code] != vol:
            conflicts.append({"ts_code": code, "volumes": [holdings[code], vol]})
        holdings[code] = vol
    if not holdings:
        return {"value": None, "ratio": None, "status": "not_disclosed", "count": 0, "denominator": denominator}
    if conflicts:
        return {"value": None, "ratio": None, "status": "conflicting_records", "count": len(holdings),
                "denominator": denominator, "conflicts": conflicts}
    missing = [code for code, vol in holdings.items() if vol > 0 and not prices.get(code, {}).get("close")]
    value = sum(vol * prices[code]["close"] / 1e8 for code, vol in holdings.items() if vol > 0 and code not in missing)
    stale = [dict(ts_code=code, **prices[code]) for code, vol in holdings.items()
             if vol > 0 and code in prices and prices[code]["date"] != date]
    return {"value": round(value, 4) if not missing else None,
            "ratio": round(value / denominator * 100, 5) if not missing else None,
            "denominator": round(denominator, 4), "count": len(holdings),
            "status": "missing_prices" if missing else "available", "missingPrices": missing, "carriedPrices": stale}


def combine(sh, sz):
    applicable = [sh] if sz["status"] == "not_open" else [sh, sz]
    available = all(row["value"] is not None for row in applicable)
    value = sum(row["value"] for row in applicable) if available else None
    denominator = sh["denominator"] + sz["denominator"]
    return {"value": round(value, 4) if available else None,
            "ratio": round(value / denominator * 100, 5) if available else None,
            "denominator": round(denominator, 4), "count": sum(row["count"] for row in applicable),
            "status": "available" if available else "incomplete"}


def market_caps(token, period, date, existing):
    prior = existing.get(period)
    if prior and prior["date"] == date:
        return {m.lower(): prior["exchanges"][m]["amount"] for m in ("SH", "SZ")}
    sh = indexed(cached(token, "daily_info", {"trade_date": date, "exchange": "SH"}, "trade_date,ts_code,com_count,total_mv"), date)
    sz = indexed(cached(token, "sz_daily_info", {"trade_date": date}, "trade_date,ts_code,count,total_mv"), date)
    sh_codes = ["SH_A"] + (["SH_STAR"] if date >= "20190722" else [])
    sz_codes = ["主板A股", "创业板A股" if "创业板A股" in sz else "创业板"] + (["中小板"] if date < "20210406" else [])
    return {"sh": sum(board(sh.get(code), "com_count")["amount"] for code in sh_codes),
            "sz": sum(board(sz.get(code), "count", 1e8)["amount"] for code in sz_codes)}


def main():
    token = get_token()
    existing = json.loads((ROOT / "work/a_share_market_cap.json").read_text())["periods"]
    series = []
    for year in range(2014, int(END_DATE[:4]) + 1):
        days = cached(token, "trade_cal", {"exchange": "SSE", "start_date": f"{year}0101", "end_date": min(f"{year}1231", END_DATE), "is_open": "1"}, "cal_date,is_open")
        opened = sorted(r["cal_date"] for r in days)
        for month in (3, 6, 9, 12):
            period = f"{year}{month:02d}{calendar.monthrange(year, month)[1]:02d}"
            if period < "20141117" or period > END_DATE:
                continue
            date = max(day for day in opened if day <= period)
            caps = market_caps(token, period, date, existing)
            holdings = {m: cached(token, "hk_hold", {"trade_date": date, "exchange": m.upper()}, "trade_date,ts_code,vol")
                        if m == "sh" or date >= "20161205" else [] for m in ("sh", "sz")}
            prices = {}
            if any(holdings.values()):
                for row in cached(token, "daily", {"trade_date": date}, "ts_code,trade_date,close"):
                    close = finite(row.get("close"))
                    if close and close > 0:
                        prices[row["ts_code"]] = {"close": close, "date": row["trade_date"]}
                missing = {r["ts_code"] for rows in holdings.values() for r in rows
                           if sh_sz_a_share(r["ts_code"]) and finite(r.get("vol")) and r["ts_code"] not in prices}
                for code in sorted(missing):
                    start = (datetime.strptime(date, "%Y%m%d") - timedelta(days=730)).strftime("%Y%m%d")
                    history = cached(token, "daily", {"ts_code": code, "start_date": start, "end_date": date}, "ts_code,trade_date,close")
                    valid = [r for r in history if finite(r.get("close")) and float(r["close"]) > 0 and r["trade_date"] <= date]
                    if valid:
                        row = max(valid, key=lambda r: r["trade_date"])
                        prices[code] = {"close": float(row["close"]), "date": row["trade_date"]}
            point = {"date": f"{date[:4]}-{date[4:6]}-{date[6:]}", "period": period}
            for m in ("sh", "sz"):
                point[m] = aggregate(holdings[m], prices, caps[m], m, date)
            point["all"] = combine(point["sh"], point["sz"])
            series.append(point)
            print(date, [(m, point[m]["status"], point[m]["value"], len(point[m].get("carriedPrices", []))) for m in ("sh", "sz")], flush=True)
    if not any(row["all"]["value"] is not None for row in series):
        raise ValueError("No complete northbound snapshots; refusing to replace data")
    result = {"meta": {"checkedAt": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
                       "source": "Tushare hk_hold (shares) + unadjusted daily close + exchange A-share market caps",
                       "scope": "Shanghai and Shenzhen A shares only; excludes Beijing, B/H shares and funds",
                       "frequency": "quarterly", "priceMethod": "Last available unadjusted close on or before period end; carried dates audited per stock",
                       "ratioDenominator": "Same-period entire corresponding exchange A-share capitalization, including restricted shares",
                       "referenceProject": "6-Bili-xiaodeng: quarter-end holding value and capitalization ratio"}, "series": series}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
