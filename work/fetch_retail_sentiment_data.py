import json
import math
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from tushare_client import END_DATE, call_api_pages, get_token
from refresh_cache import fetch_range, range_path, write_json


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "retail_sentiment_data.json"
CACHE = ROOT / ".tools" / "retail-history"
START_YEAR = 2005
END_YEAR = int(END_DATE[:4])
FIELDS = ("amount", "volume", "turnover", "marginBalance", "marginFloatRatio", "marginBuyRatio", "limitUpCount")
AVERAGE_FIELDS = {"amount", "volume", "turnover"}
MARKET_FIELDS = "trade_date,ts_code,float_mv,amount,tr"
MARKET_CODES = ("SH_A", "SH_B", "SH_STAR", "SH_MARKET", "SZ_MARKET")


def cached_rows(token, api_name, params, fields, page_size, reusable):
    return fetch_range(token, api_name, params, fields,
                       lambda t, a, p, f: call_api_pages(t, a, p, f, page_size),
                       seeds=CACHE.glob(f"{api_name}-*.json"))


def yearly(token, api_name, base_params, fields, start_year=START_YEAR):
    rows = []
    for year in range(start_year, END_YEAR + 1):
        params = {**base_params, "start_date": f"{year}0101",
                  "end_date": END_DATE if year == END_YEAR else f"{year}1231"}
        rows.extend(cached_rows(token, api_name, params, fields, 4000, year < END_YEAR))
    print(json.dumps({"api": api_name, "scope": base_params, "rows": len(rows)}), flush=True)
    return rows


def monthly_limit_counts(token):
    counts = defaultdict(set)
    for year in range(2020, END_YEAR + 1):
        for month in range(1, 13):
            start = f"{year}{month:02d}01"
            if start > END_DATE:
                break
            next_year = year + (month == 12)
            next_month = 1 if month == 12 else month + 1
            end = min((datetime(next_year, next_month, 1) - timedelta(days=1)).strftime("%Y%m%d"), END_DATE)
            rows = cached_rows(token, "limit_list_d", {"start_date": start, "end_date": end, "limit_type": "U"},
                               "trade_date,ts_code", 2500, start[:6] < END_DATE[:6])
            for row in rows:
                counts[row["trade_date"]].add(row["ts_code"])
        print(json.dumps({"api": "limit_list_d", "year": year, "observedDays": len(counts)}), flush=True)
    # An empty source response cannot establish a genuine zero-limit-up day.
    return {date: len(codes) for date, codes in counts.items()}


def number(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value >= 0


def complete_sum(rows, field):
    return sum(row[field] for row in rows) if rows and all(number(row.get(field)) for row in rows) else None


def indexed(rows, field):
    result = defaultdict(dict)
    for row in rows:
        date, code = row["trade_date"], row[field]
        if code in result[date] and result[date][code] != row:
            raise ValueError(f"Conflicting {field} record: {date} {code}")
        result[date][code] = row
    return result


def attach_volume(market_rows, volume_rows, sz_stock_rows=()):
    volumes = indexed(volume_rows, "ts_code")
    sz_stocks = indexed(sz_stock_rows, "ts_code")
    result = []
    for row in market_rows:
        date, code = row["trade_date"], row["ts_code"]
        daily = volumes.get(date, {})
        value = daily.get(code, {}).get("vol")
        if code == "SZ_MARKET":
            stock_volume = sz_stocks.get(date, {}).get("股票", {}).get("vol")
            if number(stock_volume):
                value = stock_volume / 1e8
            elif not number(value):
                codes = ["SZ_MAIN"] + (["SZ_SME"] if date < "20210406" else []) + (["SZ_GEM"] if date >= "20091030" else [])
                boards = [daily[key] for key in codes] if all(key in daily for key in codes) else []
                value = complete_sum(boards, "vol")
        result.append({**row, "vol": value})
    return result


def volume_data(token):
    volumes = yearly(token, "daily_info", {"exchange": "SH,SZ"}, "trade_date,ts_code,vol")
    sz_stocks = yearly(token, "sz_daily_info", {"ts_code": "股票"}, "trade_date,ts_code,vol")
    return volumes, sz_stocks


def build_daily_series(market_rows, margins, limit_counts):
    market_by_date = indexed(market_rows, "ts_code")
    margin_by_date = indexed(margins, "exchange_id")
    series, comparisons = [], []
    for date in sorted(set(market_by_date) | set(margin_by_date) | set(limit_counts)):
        market = market_by_date.get(date, {})
        sh_codes = ["SH_A", "SH_B"] + (["SH_STAR"] if date >= "20190722" else [])
        sh_boards = [market[code] for code in sh_codes] if all(code in market for code in sh_codes) else []
        sh = market.get("SH_MARKET")
        if sh and sh_boards:
            for field in ("amount", "float_mv", "vol"):
                total = complete_sum(sh_boards, field)
                if total is not None and number(sh.get(field)):
                    difference = abs(total - sh[field])
                    if difference > max(0.05, sh[field] * 0.0001):
                        raise ValueError(f"Shanghai board total mismatch: {date} {field}")
                    comparisons.append(difference)
        if sh is None and sh_boards:
            sh = {field: complete_sum(sh_boards, field) for field in ("amount", "float_mv", "vol")}
        sz = market.get("SZ_MARKET")
        exchanges = [sh, sz] if sh and sz else []
        amount = complete_sum(exchanges, "amount")
        volume = complete_sum(exchanges, "vol")
        float_mv = complete_sum(exchanges, "float_mv")
        # Use the same disjoint board weights throughout the historical series.
        boards = sh_boards + [sz] if sh_boards and sz else []
        board_mv = complete_sum(boards, "float_mv")
        turnover = sum(row["tr"] * row["float_mv"] for row in boards) / board_mv \
            if board_mv and all(number(row.get("tr")) for row in boards) else None
        daily_margins = margin_by_date.get(date, {})
        margin_rows = [daily_margins[e] for e in ("SSE", "SZSE")] if all(e in daily_margins for e in ("SSE", "SZSE")) else []
        balance = complete_sum(margin_rows, "rzye")
        buy = complete_sum(margin_rows, "rzmre")
        values = {"amount": amount, "volume": volume, "turnover": turnover,
                  "marginBalance": balance / 1e8 if balance is not None else None,
                  "marginFloatRatio": balance / 1e8 / float_mv * 100 if balance is not None and float_mv else None,
                  "marginBuyRatio": buy / 1e8 / amount * 100 if buy is not None and amount else None,
                  "limitUpCount": limit_counts.get(date)}
        series.append({"date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                       **{key: round(value, 4 if key in ("volume", "turnover", "marginFloatRatio", "marginBuyRatio") else 2)
                          if value is not None else None for key, value in values.items()}})
    return series, {"shBoardChecks": len(comparisons), "maxRoundingDifferenceYi": max(comparisons, default=0)}


def build_exchange_series(market_rows, margins):
    market_by_date = indexed(market_rows, "ts_code")
    margin_by_date = indexed(margins, "exchange_id")
    result = {"sh": [], "sz": []}
    for date in sorted(set(market_by_date) | set(margin_by_date)):
        market = market_by_date.get(date, {})
        sh_codes = ["SH_A", "SH_B"] + (["SH_STAR"] if date >= "20190722" else [])
        sh_boards = [market[code] for code in sh_codes] if all(code in market for code in sh_codes) else []
        sh = market.get("SH_MARKET")
        sh_amount = sh.get("amount") if sh else complete_sum(sh_boards, "amount")
        sh_volume = sh.get("vol") if sh else complete_sum(sh_boards, "vol")
        sh_float = sh.get("float_mv") if sh else complete_sum(sh_boards, "float_mv")
        sh_turnover = None
        sh_board_float = complete_sum(sh_boards, "float_mv")
        if sh_board_float and all(number(row.get("tr")) for row in sh_boards):
            sh_turnover = sum(row["tr"] * row["float_mv"] for row in sh_boards) / sh_board_float
        sz = market.get("SZ_MARKET")
        for key, amount, volume, float_mv, turnover, exchange in (
            ("sh", sh_amount, sh_volume, sh_float, sh_turnover, "SSE"),
            ("sz", sz.get("amount") if sz else None, sz.get("vol") if sz else None, sz.get("float_mv") if sz else None,
             sz.get("tr") if sz else None, "SZSE"),
        ):
            margin = margin_by_date.get(date, {}).get(exchange)
            balance = margin.get("rzye") if margin else None
            values = {"amount": amount, "volume": volume, "turnover": turnover,
                      "marginBalance": balance / 1e8 if number(balance) else None,
                      "marginFloatRatio": balance / 1e8 / float_mv * 100 if number(balance) and number(float_mv) and float_mv else None}
            if any(value is not None for value in values.values()):
                result[key].append({"date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                                    **{field: round(value, 4 if field in ("volume", "turnover", "marginFloatRatio") else 2)
                                       if value is not None else None for field, value in values.items()}})
    return {key: sample_by_week(rows) for key, rows in result.items()}


def sample_by_week(rows):
    fields = list(dict.fromkeys(field for row in rows for field in row if field != "date"))
    weeks = {}
    for row in sorted(rows, key=lambda row: row["date"]):
        date = datetime.strptime(row["date"], "%Y-%m-%d")
        key = (date.isocalendar().year, date.isocalendar().week)
        observations = weeks.setdefault(key, {})
        for field in fields:
            if number(row.get(field)):
                observations.setdefault(field, []).append((row["date"], row[field]))
    # Preserve each metric's own date; never carry an observation into another week.
    by_date = {}
    for observations in weeks.values():
        for field, points in observations.items():
            date, value = points[-1]
            row = by_date.setdefault(date, {"date": date, **{name: None for name in fields}})
            if field in AVERAGE_FIELDS:
                value = round(sum(point[1] for point in points) / len(points), 2 if field == "amount" else 4)
                row.setdefault("weeklySamples", {})[field] = {
                    "start": points[0][0], "end": date, "days": len(points)}
            row[field] = value
    return [by_date[date] for date in sorted(by_date)]


def coverage(rows):
    result = {}
    for field in FIELDS:
        dates = [row["date"] for row in rows if number(row.get(field))]
        result[field] = {"start": dates[0] if dates else None, "end": dates[-1] if dates else None, "points": len(dates)}
    return result


def update_methodology(result):
    result["meta"]["methodology"]["sampling"] = (
        "amount/volume/turnover: arithmetic mean of valid trading-day observations per ISO week; "
        "other metrics: last valid observation per ISO week; x-axis uses each metric's last observation date")
    result["meta"]["methodology"]["turnover"] = (
        "First calculate daily float_mv-weighted turnover from disjoint boards, then average the daily rates within each week")
    result["meta"]["methodology"]["weeklyMean"] = (
        "ISO Monday-Sunday weeks; holidays/weekends and missing values excluded, valid zeros included; "
        "partial weeks average only observations available by the data cutoff; per-point dates/day counts stored in weeklySamples")
    result["meta"]["sources"]["volume"] = (
        "SH: daily_info.vol in 100 million shares, SH_MARKET or SH_A+SH_B before 2019; "
        "SZ: sz_daily_info 股票.vol in shares / 1e8; if missing use daily_info SZ_MARKET.vol, "
        "then disjoint SZ_MAIN+SZ_SME (before 2021-04-06)+SZ_GEM (from 2009-10-30), all in 100 million shares")


def rebuild_market_weekly():
    result = json.loads(OUTPUT.read_text(encoding="utf-8"))
    end = result["meta"]["requestedEnd"]
    if END_DATE != end:
        raise ValueError(f"Set MARKET_END_DATE={end} to rebuild the existing period without refreshing other metrics")
    market_rows = []
    for code in MARKET_CODES:
        for year in range(2019 if code in ("SH_STAR", "SH_MARKET") else START_YEAR, int(end[:4]) + 1):
            params = {"ts_code": code, "start_date": f"{year}0101",
                      "end_date": end if year == int(end[:4]) else f"{year}1231"}
            target = range_path("daily_info", params, MARKET_FIELDS)
            cached = json.loads(target.read_text()) if target.exists() else {}
            if cached.get("end", "") < params["end_date"]:
                raise ValueError(f"Missing full raw market range: {code} {year}; run the normal retail refresh")
            market_rows.extend(row for row in cached["rows"] if params["start_date"] <= row["trade_date"] <= params["end_date"])
    market_rows = attach_volume(market_rows, *volume_data(get_token()))
    daily, checks = build_daily_series(market_rows, [], {})
    weekly = sample_by_week(daily)
    exchanges = build_exchange_series(market_rows, [])

    def replace_market_fields(old_rows, new_rows):
        fields = [field for field in FIELDS if field in AVERAGE_FIELDS or any(field in row for row in old_rows)]
        by_date = {row["date"]: {key: value for key, value in row.items() if key not in AVERAGE_FIELDS and key != "weeklySamples"}
                   for row in old_rows}
        for row in new_rows:
            target = by_date.setdefault(row["date"], {"date": row["date"]})
            target.update({field: row.get(field) for field in AVERAGE_FIELDS})
            if row.get("weeklySamples"):
                target["weeklySamples"] = row["weeklySamples"]
        return [{**{field: None for field in fields}, **row} for _, row in sorted(by_date.items())
                if any(number(row.get(field)) for field in FIELDS)]

    result["series"] = replace_market_fields(result["series"], weekly)
    result["markets"] = {key: replace_market_fields(result["markets"][key], rows) for key, rows in exchanges.items()}
    result["meta"]["coverage"] = coverage(result["series"])
    result["meta"]["marketCoverage"] = {key: coverage(rows) for key, rows in result["markets"].items()}
    for field in AVERAGE_FIELDS:
        result["meta"]["dailyCoverage"][field] = coverage(daily)[field]
    if result["meta"]["coverage"]["volume"]["end"] != result["meta"]["coverage"]["amount"]["end"]:
        raise ValueError("Latest volume coverage is incomplete; retaining the published file")
    result["meta"]["validation"] = checks
    update_methodology(result)
    write_json(OUTPUT, result)
    print(json.dumps({"output": str(OUTPUT), "end": end, "coverage": result["meta"]["coverage"]}, ensure_ascii=False))


def main():
    token = get_token()
    market_rows, margins = [], []
    for code in MARKET_CODES:
        market_rows.extend(yearly(token, "daily_info", {"ts_code": code},
                                  MARKET_FIELDS, 2019 if code in ("SH_STAR", "SH_MARKET") else START_YEAR))
    market_rows = attach_volume(market_rows, *volume_data(token))
    for exchange in ("SSE", "SZSE"):
        margins.extend(yearly(token, "margin", {"exchange_id": exchange}, "trade_date,exchange_id,rzye,rzmre", 2010))
    series, checks = build_daily_series(market_rows, margins, monthly_limit_counts(token))
    weekly = sample_by_week(series)
    markets = build_exchange_series(market_rows, margins)
    if not weekly:
        raise ValueError("No retail sentiment observations returned")
    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
            "requestedStart": f"{START_YEAR}-01-01", "start": series[0]["date"], "end": weekly[-1]["date"],
            "frequency": "weekly", "coverage": coverage(weekly), "dailyCoverage": coverage(series), "validation": checks,
            "marketCoverage": {market: coverage(rows) for market, rows in markets.items()},
            "sources": {"market": "Tushare daily_info: SH_MARKET (SH_A + SH_B before 2019) + SZ_MARKET",
                        "turnover": "Tushare daily_info: float_mv-weighted tr of SH_A, SH_B, SH_STAR (since 2019-07-22), SZ_MARKET",
                        "margin": "Tushare margin: SSE + SZSE, from 2010-03-31",
                        "limit": "Tushare limit_list_d: non-ST, available since 2020"},
            "methodology": {"scope": "Shanghai/Shenzhen stocks including A/B shares; excludes Beijing, funds and bonds",
                            "sampling": "Last available observation per metric per ISO week, with its actual date; not a weekly sum",
                            "turnover": "All years use disjoint board float_mv weights; replaces the previous exchange-level weights",
                            "missing": "No zero fill or carry-forward; financing starts with the 2010 launch; limit list starts in 2020"},
        },
        "series": weekly,
        "markets": markets,
    }
    update_methodology(result)
    write_json(OUTPUT, result)
    print(json.dumps({"output": str(OUTPUT), "points": len(weekly), "coverage": result["meta"]["coverage"], "validation": checks}, ensure_ascii=False))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild-market-weekly", action="store_true")
    args = parser.parse_args()
    rebuild_market_weekly() if args.rebuild_market_weekly else main()
