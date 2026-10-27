import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from tushare_client import END_DATE, call_api_pages, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "retail_sentiment_data.json"
CACHE = ROOT / ".tools" / "retail-history"
START_YEAR = 2006
END_YEAR = int(END_DATE[:4])
FIELDS = ("amount", "turnover", "marginBalance", "marginFloatRatio", "marginBuyRatio", "limitUpCount")


def cached_rows(token, api_name, params, fields, page_size, reusable):
    key = hashlib.sha256(json.dumps([api_name, params, fields], sort_keys=True).encode()).hexdigest()
    target = CACHE / f"{api_name}-{key}.json"
    if reusable and target.exists():
        return json.loads(target.read_text())["rows"]
    rows = call_api_pages(token, api_name, params, fields, page_size)
    CACHE.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"api": api_name, "params": params, "fields": fields,
                                 "fetchedAt": datetime.now().isoformat(), "rows": rows}), encoding="utf-8")
    return rows


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
            for field in ("amount", "float_mv"):
                total = complete_sum(sh_boards, field)
                if total is not None and number(sh.get(field)):
                    difference = abs(total - sh[field])
                    if difference > max(0.05, sh[field] * 0.0001):
                        raise ValueError(f"Shanghai board total mismatch: {date} {field}")
                    comparisons.append(difference)
        if sh is None and sh_boards:
            sh = {field: complete_sum(sh_boards, field) for field in ("amount", "float_mv")}
        sz = market.get("SZ_MARKET")
        exchanges = [sh, sz] if sh and sz else []
        amount = complete_sum(exchanges, "amount")
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
        values = {"amount": amount, "turnover": turnover,
                  "marginBalance": balance / 1e8 if balance is not None else None,
                  "marginFloatRatio": balance / 1e8 / float_mv * 100 if balance is not None and float_mv else None,
                  "marginBuyRatio": buy / 1e8 / amount * 100 if buy is not None and amount else None,
                  "limitUpCount": limit_counts.get(date)}
        series.append({"date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                       **{key: round(value, 4 if key in ("turnover", "marginFloatRatio", "marginBuyRatio") else 2)
                          if value is not None else None for key, value in values.items()}})
    return series, {"shBoardChecks": len(comparisons), "maxRoundingDifferenceYi": max(comparisons, default=0)}


def last_by_week(rows):
    fields = list(dict.fromkeys(field for row in rows for field in row if field != "date"))
    weeks = {}
    for row in rows:
        date = datetime.strptime(row["date"], "%Y-%m-%d")
        key = (date.isocalendar().year, date.isocalendar().week)
        observations = weeks.setdefault(key, {})
        for field in fields:
            if row.get(field) is not None:
                observations[field] = (row["date"], row[field])
    # Preserve each metric's own date; never carry an observation into another week.
    by_date = {}
    for observations in weeks.values():
        for field, (date, value) in observations.items():
            by_date.setdefault(date, {"date": date, **{name: None for name in fields}})[field] = value
    return [by_date[date] for date in sorted(by_date)]


def coverage(rows):
    result = {}
    for field in FIELDS:
        dates = [row["date"] for row in rows if number(row.get(field))]
        result[field] = {"start": dates[0] if dates else None, "end": dates[-1] if dates else None, "points": len(dates)}
    return result


def main():
    token = get_token()
    market_rows, margins = [], []
    for code in ("SH_A", "SH_B", "SH_STAR", "SH_MARKET", "SZ_MARKET"):
        market_rows.extend(yearly(token, "daily_info", {"ts_code": code},
                                  "trade_date,ts_code,float_mv,amount,tr", 2019 if code in ("SH_STAR", "SH_MARKET") else START_YEAR))
    for exchange in ("SSE", "SZSE"):
        margins.extend(yearly(token, "margin", {"exchange_id": exchange}, "trade_date,exchange_id,rzye,rzmre", 2010))
    series, checks = build_daily_series(market_rows, margins, monthly_limit_counts(token))
    weekly = last_by_week(series)
    if not weekly:
        raise ValueError("No retail sentiment observations returned")
    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
            "requestedStart": f"{START_YEAR}-01-01", "start": series[0]["date"], "end": weekly[-1]["date"],
            "frequency": "weekly", "coverage": coverage(weekly), "dailyCoverage": coverage(series), "validation": checks,
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
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "points": len(weekly), "coverage": result["meta"]["coverage"], "validation": checks}, ensure_ascii=False))


if __name__ == "__main__":
    main()
