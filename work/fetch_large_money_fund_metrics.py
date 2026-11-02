"""Audited fund-report and listed equity ETF series, following project 6."""
import argparse
import hashlib
import json
import math
import os
import re
import tempfile
import time
import urllib.error
from bisect import bisect_right
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock, Semaphore

from tushare_client import END_DATE, call_api, call_api_pages, get_token
from refresh_cache import full_refresh, write_json
from fetch_large_money_sentiment_data import sh_sz_a_share

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools/fund-metrics"
REPORTS = ROOT / "work/large_money_fund_reports.json"
ETF = ROOT / "work/large_money_etf_shares.json"
TODAY = datetime.now().strftime("%Y-%m-%d")
RATE_LOCK = Lock()
IN_FLIGHT = Semaphore(8)
NEXT_REQUEST = 0.0


def portfolio_pages(token, params, fields, size, key):
    """Bounded parallel pagination; completed pages survive interrupted refreshes."""
    def page(offset):
        global NEXT_REQUEST
        target = CACHE / f"page-{key}-{size}-{offset}.json"
        if target.exists() and not full_refresh() and os.environ.get("MARKET_REPORT_REFRESH") != "1":
            return json.loads(target.read_text())
        with IN_FLIGHT:
            with RATE_LOCK:
                delay = max(0, NEXT_REQUEST - time.monotonic())
                NEXT_REQUEST = max(time.monotonic(), NEXT_REQUEST) + .35
            time.sleep(delay)
            for attempt in range(2):
                try:
                    rows = call_api(token, "fund_portfolio", {**params, "limit": size, "offset": offset}, fields)
                    break
                except urllib.error.HTTPError as error:
                    if attempt or error.code < 500 and error.code != 429:
                        raise
                    print("Retry portfolio page", params["period"], offset, "HTTP", error.code, flush=True)
                    time.sleep(5)
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=CACHE, delete=False) as handle:
            json.dump(rows, handle, ensure_ascii=False, separators=(",", ":"))
            temporary = Path(handle.name)
        temporary.replace(target)
        return rows
    rows, offset, signatures = [], 0, set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            pages = list(pool.map(page, range(offset, offset + size * 4, size)))
            complete = False
            for result in pages:
                signature = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
                if result and (signature in signatures or complete):
                    raise RuntimeError("Repeated or inconsistent portfolio pages")
                signatures.add(signature)
                rows.extend(result)
                complete = complete or len(result) < size
            if complete:
                return rows
            offset += size * 4


def request(token, api, params, fields, size=8000):
    key = hashlib.sha256(json.dumps([api, params, fields], sort_keys=True).encode()).hexdigest()[:24]
    target = CACHE / f"{api}-{key}.json"
    if target.exists() and not full_refresh() and os.environ.get("MARKET_REPORT_REFRESH") != "1":
        try:
            return json.loads(target.read_text())
        except json.JSONDecodeError:
            pass
    rows = portfolio_pages(token, params, fields, size, key) if api == "fund_portfolio" else call_api_pages(token, api, params, fields, size)
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=CACHE, delete=False) as handle:
        json.dump(rows, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = Path(handle.name)
    temporary.replace(target)
    return rows


def number(value):
    return value is not None and math.isfinite(float(value))


def iso(date):
    return f"{date[:4]}-{date[4:6]}-{date[6:]}"


def basics(token):
    result = {}
    fields = "ts_code,name,fund_type,invest_type,found_date,due_date,list_date,delist_date,status"
    for market in ("E", "O"):
        for status in ("L", "D"):
            rows = request(token, "fund_basic", {"market": market, "status": status}, fields)
            result.update({r["ts_code"]: r for r in rows})
    return result


def is_active(fund):
    return (fund.get("fund_type") in ("股票型", "混合型")
            and fund.get("invest_type") not in ("被动指数型", "增强指数型")
            and not re.search(r"ETF|指数|联接|FOF|QDII", fund.get("name") or "", re.I))


def aggregate_report(period, funds, nav_rows, portfolio):
    nav = {}
    for row in nav_rows:
        code = row["ts_code"]
        if code in funds and row.get("nav_date") == period and number(row.get("net_asset")) and float(row["net_asset"]) > 0:
            amount = float(row["net_asset"])
            if code in nav and nav[code] != amount:
                raise ValueError(f"Conflicting NAV: {period} {code}")
            nav[code] = amount
    positions = defaultdict(dict)
    conflicts = set()
    for row in portfolio:
        code, symbol = row["ts_code"], row.get("symbol")
        if code not in nav or row.get("end_date") != period or not symbol:
            continue
        if not number(row.get("mkv")) or not number(row.get("stk_mkv_ratio")):
            continue
        prior = positions[code].get(symbol)
        if prior and prior.get("ann_date") == row.get("ann_date") and (prior["mkv"], prior["stk_mkv_ratio"]) != (row["mkv"], row["stk_mkv_ratio"]):
            conflicts.add(code)
        if prior is None or (row.get("ann_date") or "") > (prior.get("ann_date") or ""):
            positions[code][symbol] = row
    stocks = {m: defaultdict(float) for m in ("all", "sh", "sz")}
    assets, included, duplicate = 0.0, [], []
    fingerprints = set()
    # Share classes can repeat the exact same portfolio; count one representative.
    for code in sorted(positions, key=lambda c: (-nav[c], c)):
        holdings = positions[code]
        stock = sum(float(r["mkv"]) for r in holdings.values())
        ratio = sum(float(r["stk_mkv_ratio"]) for r in holdings.values())
        if code in conflicts or not 90 <= ratio <= 110 or not 0 < stock <= nav[code] * 1.2:
            continue
        if any(float(r["mkv"]) < 0 or float(r["stk_mkv_ratio"]) < 0 for r in holdings.values()):
            continue
        fingerprint = tuple(sorted((s, float(r["mkv"])) for s, r in holdings.items()))
        if fingerprint in fingerprints:
            duplicate.append(code)
            continue
        fingerprints.add(fingerprint)
        included.append(code)
        assets += nav[code]
        for symbol, row in holdings.items():
            if sh_sz_a_share(symbol):
                market = symbol[-2:].lower()
                stocks[market][symbol] += float(row["mkv"])
                stocks["all"][symbol] += float(row["mkv"])
    denominator = len(nav) - len(duplicate)
    coverage = len(included) / denominator * 100 if denominator else 0
    point = {"date": iso(period), "funds": len(included), "navFunds": len(nav),
             "coverage": round(coverage, 2), "netAssets": round(assets, 2),
             "duplicatesExcluded": duplicate, "conflictsExcluded": sorted(conflicts)}
    for market, values in stocks.items():
        amount = sum(values.values())
        available = coverage >= 40 and assets > 0
        point[market] = {"position": round(amount / assets * 100, 4) if available else None,
                         "concentration": round(sum(sorted(values.values(), reverse=True)[:10]) / amount * 100, 4)
                         if available and amount else None,
                         "stockValue": round(amount, 2), "stockCount": len(values)}
    return point


def fetch_reports(token, basic, full_history=False):
    funds = {c: f for c, f in basic.items() if is_active(f)}
    periods = [f"{y}{end}" for y in range(2005, int(END_DATE[:4]) + 1)
               for end in ("0630", "1231") if f"{y}{end}" <= END_DATE]
    existing = json.loads(REPORTS.read_text()) if REPORTS.exists() else {}
    historical = {row["date"].replace("-", ""): row for row in existing.get("series", [])}
    def report(period):
        if not full_history and period in historical and period not in periods[-2:]:
            return historical[period]
        nav = []
        for market in ("E", "O"):
            nav.extend(request(token, "fund_nav", {"nav_date": period, "market": market}, "ts_code,nav_date,net_asset"))
        holdings = request(token, "fund_portfolio", {"period": period}, "ts_code,ann_date,end_date,symbol,mkv,stk_mkv_ratio")
        result = aggregate_report(period, funds, nav, holdings)
        print("report", period, result["funds"], result["coverage"], flush=True)
        return result
    def audited_report(period):
        try:
            return report(period)
        except Exception as error:
            print("FAILED report", period, str(error), flush=True)
            raise
    with ThreadPoolExecutor(max_workers=6) as pool:
        series = sorted(pool.map(audited_report, reversed(periods)), key=lambda row: row["date"])
    if not any(row["all"]["position"] is not None for row in series):
        raise RuntimeError("No qualified fund reports; retaining previous output")
    REPORTS.write_text(json.dumps({"meta": {"checkedAt": TODAY, "end": END_DATE,
        "source": "Tushare fund_basic + fund_nav + fund_portfolio", "frequency": "semiannual",
        "scope": "Active stock/mixed funds, Shanghai/Shenzhen A-share holdings only",
        "coverageThreshold": 40, "portfolioCoverageRange": [90, 110],
        "deduplication": "Latest stock disclosure per fund; identical whole portfolios counted once, largest NAV representative",
        "limitation": "Changing sample; current fund classification used historically; not all institutional holdings"},
        "series": series}, ensure_ascii=False, separators=(",", ":")))


def etf_point(date, histories):
    day = datetime.strptime(date, "%Y%m%d")
    sums = {m: 0.0 for m in ("sh", "sz")}
    eligible = {m: 0 for m in sums}
    reported = {m: 0 for m in sums}
    for fund, dates, values in histories:
        market = fund["ts_code"][-2:].lower()
        if fund["list_date"] > date or fund.get("delist_date") and fund["delist_date"] <= date:
            continue
        eligible[market] += 1
        i = bisect_right(dates, date) - 1
        if i < 0 or (day - datetime.strptime(dates[i], "%Y%m%d")).days > 15:
            continue
        reported[market] += 1
        sums[market] += values[dates[i]]
    result = {"date": iso(date), "eligible": eligible, "reported": reported}
    for market in sums:
        result[market] = round(sums[market], 4) if eligible[market] and reported[market] / eligible[market] >= .9 else None
    result["all"] = round(sum(sums.values()), 4) if sum(eligible.values()) and all(
        not eligible[m] or result[m] is not None for m in sums) else None
    return result


def fetch_etfs(token, basic):
    funds = {}
    excluded = []
    excluded_codes = []
    for status in ("L", "D"):
        for row in request(token, "etf_basic", {"list_status": status}, "ts_code,csname,list_date,list_status,etf_type"):
            code = row["ts_code"]
            if not code.endswith((".SH", ".SZ")):
                excluded_codes.append(code)
                continue
            ref = basic.get(code, {})
            if ref.get("fund_type") != "股票型":
                continue
            fund = {**row, "delist_date": ref.get("delist_date")}
            if not fund.get("list_date") or status == "D" and not fund["delist_date"]:
                excluded.append(code)
                continue
            funds[code] = fund
    if not funds:
        raise RuntimeError("No listed equity ETFs identified")
    if ETF.exists() and not full_refresh():
        previous = json.loads(ETF.read_text())
        update_etfs_by_day(token, funds, previous, excluded, excluded_codes)
        return
    def history(fund):
        rows = request(token, "fund_share", {"ts_code": fund["ts_code"], "start_date": "20050101", "end_date": END_DATE},
                       "ts_code,trade_date,fd_share", 2000)
        values = {}
        for row in rows:
            if row["ts_code"] != fund["ts_code"] or row["trade_date"] > END_DATE:
                raise ValueError("Unexpected ETF code or date")
            if not number(row.get("fd_share")) or float(row["fd_share"]) < 0:
                continue
            date, value = row["trade_date"], float(row["fd_share"]) / 10000
            if date in values and values[date] != value:
                raise ValueError("Conflicting ETF share records")
            values[date] = value
        return fund, sorted(values), values
    histories = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        for i, result in enumerate(pool.map(history, funds.values()), 1):
            histories.append(result)
            if i % 50 == 0:
                print("ETF", i, "/", len(funds), flush=True)
    days = request(token, "trade_cal", {"exchange": "SSE", "start_date": "20050101", "end_date": END_DATE, "is_open": "1"}, "cal_date,is_open")
    weeks = {}
    for row in days:
        date = row["cal_date"]
        key = datetime.strptime(date, "%Y%m%d").isocalendar()[:2]
        weeks[key] = max(weeks.get(key, ""), date)
    series = [etf_point(date, histories) for date in sorted(weeks.values())]
    if not any(row["all"] is not None for row in series):
        raise RuntimeError("No complete ETF snapshots; retaining previous output")
    ETF.write_text(json.dumps({"meta": {"checkedAt": TODAY, "end": END_DATE,
        "source": "Tushare etf_basic + fund_basic + fund_share + trade_cal",
        "scope": "SH/SZ listed equity ETFs including cross-border equity ETFs, grouped by listing exchange",
        "unit": "100 million shares", "coverageThreshold": 90, "maxAgeDays": 15,
        "excludedMissingListingDates": excluded, "fundCount": len(funds),
        "excludedNonExchangeCodes": excluded_codes,
        "limitation": "Unadjusted share stock, not net subscriptions or money flow; affected by splits and sample changes"},
        "funds": list(funds.values()), "series": series}, ensure_ascii=False, separators=(",", ":")))
    print("ETF complete", len(series), "weeks", flush=True)


def update_etfs_by_day(token, funds, previous, excluded, excluded_codes):
    anchor = min(previous["meta"]["end"], END_DATE)
    start = datetime.strptime(anchor, "%Y%m%d") - timedelta(days=28)
    start -= timedelta(days=start.weekday())
    # Each point accepts shares at most 15 calendar days old.
    fetch_start = (start - timedelta(days=15)).strftime("%Y%m%d")
    days = call_api_pages(token, "trade_cal", {"exchange": "SSE", "start_date": fetch_start,
        "end_date": END_DATE, "is_open": "1"}, "cal_date,is_open", 8000)
    values = {code: {} for code in funds}
    # Some share disclosures carry weekend/holiday dates, unlike price bars.
    first = datetime.strptime(fetch_start, "%Y%m%d")
    last = datetime.strptime(END_DATE, "%Y%m%d")
    observation_days = [(first + timedelta(days=i)).strftime("%Y%m%d") for i in range((last - first).days + 1)]
    for day in observation_days:
        rows = call_api_pages(token, "fund_share", {"trade_date": day},
                              "ts_code,trade_date,fd_share", 8000)
        for row in rows:
            code = row["ts_code"]
            if row["trade_date"] != day:
                raise ValueError("Unexpected bulk ETF share date")
            if code not in funds or not number(row.get("fd_share")) or float(row["fd_share"]) < 0:
                continue
            amount = float(row["fd_share"]) / 10000
            if day in values[code] and values[code][day] != amount:
                raise ValueError("Conflicting bulk ETF shares")
            values[code][day] = amount
    weeks = {}
    for row in days:
        date = row["cal_date"]
        if date < start.strftime("%Y%m%d"):
            continue
        key = datetime.strptime(date, "%Y%m%d").isocalendar()[:2]
        weeks[key] = max(weeks.get(key, ""), date)
    # The bulk endpoint can omit individual funds that the code query returns.
    # Reconcile only those missing a valid observation at a required snapshot.
    fallback_count = 0
    for code, fund in funds.items():
        dates = sorted(values[code])
        needs_fallback = False
        for date in weeks.values():
            if fund["list_date"] > date or fund.get("delist_date") and fund["delist_date"] <= date:
                continue
            i = bisect_right(dates, date) - 1
            if i < 0 or (datetime.strptime(date, "%Y%m%d") - datetime.strptime(dates[i], "%Y%m%d")).days > 15:
                needs_fallback = True
                break
        if not needs_fallback:
            continue
        fallback_count += 1
        if fallback_count > max(10, len(funds) // 50):
            raise ValueError("Bulk ETF source is incomplete; refusing an unbounded per-fund refresh")
        rows = call_api_pages(token, "fund_share", {"ts_code": code, "start_date": fetch_start, "end_date": END_DATE},
                              "ts_code,trade_date,fd_share", 8000)
        for row in rows:
            date = row["trade_date"]
            if row["ts_code"] != code or not fetch_start <= date <= END_DATE:
                raise ValueError("Unexpected fallback ETF observation")
            if not number(row.get("fd_share")) or float(row["fd_share"]) < 0:
                continue
            amount = float(row["fd_share"]) / 10000
            if date in values[code] and values[code][date] != amount:
                raise ValueError("Bulk and individual ETF observations disagree")
            values[code][date] = amount
    histories = [(fund, sorted(values[code]), values[code]) for code, fund in funds.items()]
    fresh = [etf_point(date, histories) for date in sorted(weeks.values())]
    old_points = {row["date"]: row for row in previous["series"]}
    if not fresh or not any(row["all"] is not None for row in fresh):
        raise ValueError("No complete bulk ETF snapshots; retaining previous output")
    for row in fresh:
        if old_points.get(row["date"], {}).get("all") is not None and row["all"] is None:
            raise ValueError("Bulk ETF coverage regressed; retaining previous output")
        old = old_points.get(row["date"], {})
        if old.get("eligible") == row["eligible"] and any(row["reported"][m] < old["reported"][m] for m in ("sh", "sz")):
            raise ValueError("Bulk ETF reported sample shrank; retaining previous output")
    previous["series"] = [r for r in previous["series"] if r["date"] < start.strftime("%Y-%m-%d")] + fresh
    previous["funds"] = list(funds.values())
    previous["meta"].update(checkedAt=TODAY, end=END_DATE, excludedMissingListingDates=excluded,
        excludedNonExchangeCodes=excluded_codes, fundCount=len(funds),
        refreshMethod="Bulk daily fund_share; 28-day overlap plus 15-day observation window")
    write_json(ETF, previous)
    print("ETF incremental complete", len(fresh), "weeks;", len(observation_days),
          "calendar-day batches;", fallback_count, "individual reconciliations", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["reports", "etfs"])
    parser.add_argument("--full-history", action="store_true", help="Recompute all report periods instead of the latest two")
    args = parser.parse_args()
    global CACHE
    # Date-versioned caches allow repeatable retries and fresh later refreshes.
    CACHE = CACHE / TODAY
    token = get_token()
    basic = basics(token)
    if args.only != "etfs":
        fetch_reports(token, basic, args.full_history)
    if args.only != "reports":
        fetch_etfs(token, basic)


if __name__ == "__main__":
    main()
