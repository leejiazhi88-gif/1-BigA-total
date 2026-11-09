"""Extend the four module datasets without rewriting their newer observations."""

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from fetch_large_money_sentiment_data import aggregate_blocks, stock_universe, week_key
from fetch_retail_sentiment_data import build_daily_series, sample_by_week
from fetch_valuation_data import build_index_series
from tushare_client import call_api, call_api_pages, get_token


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"


def load(name):
    return json.loads((WORK / name).read_text(encoding="utf-8"))


def save(name, data):
    (WORK / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def years(token, api, params, fields, start, end, paged=False):
    rows = []
    for year in range(start, end + 1):
        query = {**params, "start_date": f"{year}0101", "end_date": f"{year}1231"}
        batch = call_api_pages(token, api, query, fields, 3000) if paged else call_api(token, api, query, fields)
        rows.extend(batch)
        print(api, year, len(batch), flush=True)
    return rows


def extend_valuation(token):
    data = load("valuation_data.json")
    for code, key in (("000001.SH", "sh"), ("399001.SZ", "sz")):
        rows = years(token, "index_dailybasic", {"ts_code": code}, "ts_code,trade_date,pe_ttm,pb", 2000, 2005)
        earlier = build_index_series(rows, [], {})
        pe_by_date = {f"{row['trade_date'][:4]}-{row['trade_date'][4:6]}-{row['trade_date'][6:]}": row["pe_ttm"] for row in rows}
        for row in earlier:
            row["pe"] = round(pe_by_date[row["date"]], 4)
        existing = {row["date"]: row for row in data[key]}
        for row in earlier:
            existing.setdefault(row["date"], row)
            if "pe" not in existing[row["date"]]:
                existing[row["date"]]["pe"] = row["pe"]
        data[key] = [existing[date] for date in sorted(existing)]
        print("valuation", key, data[key][0]["date"], flush=True)
    data["meta"]["start"] = min(data["sh"][0]["date"], data["sz"][0]["date"])
    save("valuation_data.json", data)


def extend_retail(token):
    data = load("retail_sentiment_data.json")
    market = []
    for code in ("SH_A", "SH_B", "SZ_MARKET"):
        market.extend(years(token, "daily_info", {"ts_code": code}, "trade_date,ts_code,float_mv,amount,tr", 2000, 2005, True))
    earlier, _ = build_daily_series(market, [], {})
    existing = {row["date"]: row for row in data["series"] if row["date"] >= "2005-01-01"}
    for row in sample_by_week(earlier):
        if row["date"] >= "2005-01-01" and any(row.get(field) is not None for field in ("amount", "turnover")):
            existing.setdefault(row["date"], row)
    data["series"] = [existing[date] for date in sorted(existing)]
    data["meta"]["start"] = data["series"][0]["date"]
    data["meta"]["requestedStart"] = "2000-01-01"
    for field in ("amount", "turnover"):
        valid = [row["date"] for row in data["series"] if row.get(field) is not None]
        data["meta"]["coverage"][field] = {"start": valid[0], "end": valid[-1], "points": len(valid)}
    data["meta"]["sources"]["historicalMarket"] = "Tushare daily_info: SH_A + SH_B + SZ_MARKET; first complete combined observations in 2005"
    save("retail_sentiment_data.json", data)
    print("retail", data["meta"]["coverage"]["amount"], flush=True)


def extend_large_money(token):
    data = load("large_money_sentiment_data.json")
    stocks = stock_universe(token)
    blocks = []
    # The provider caps broad block-trade windows at 1,000 rows, even when paging.
    for year in range(2000, 2018):
        for month in range(1, 13):
            import calendar
            end = calendar.monthrange(year, month)[1]
            blocks.extend(call_api_pages(token, "block_trade", {"start_date": f"{year}{month:02d}01", "end_date": f"{year}{month:02d}{end:02d}"},
                                         "ts_code,trade_date,price,vol,amount,buyer,seller", 1000))
        print("block_trade", year, flush=True)
    block_weeks, audit = aggregate_blocks(blocks, stocks)
    if audit["validationErrors"]:
        raise ValueError(f"Historical block records failed validation: {len(audit['validationErrors'])}")
    holders = years(token, "stk_holdertrade", {}, "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price", 2000, 2017, True)
    holder_weeks = defaultdict(lambda: {"dates": [], "netShares": 0.0})
    seen = set()
    for row in holders:
        identity = tuple(row.get(key) for key in ("ts_code", "ann_date", "holder_name", "in_de", "change_vol", "change_ratio"))
        if identity in seen or not row.get("ann_date") or row.get("ann_date") >= "20180101":
            continue
        seen.add(identity)
        date = row["ann_date"]
        item = holder_weeks[week_key(date)]
        item["dates"].append(date)
        item["netShares"] += float(row.get("change_vol") or 0) / 1e8 * (1 if row.get("in_de") == "IN" else -1)
    by_week = {week_key(row["date"].replace("-", "")): row for row in data["series"]}
    for key in sorted(set(block_weeks) | set(holder_weeks)):
        if key in by_week and by_week[key]["date"] >= "2018-01-01":
            continue
        block = block_weeks.get(key)
        holder = holder_weeks.get(key)
        dates = (block["dates"] if block else []) + (holder["dates"] if holder else [])
        by_week[key] = {"date": datetime.strptime(max(dates), "%Y%m%d").strftime("%Y-%m-%d"),
                        "blockDate": datetime.strptime(max(block["dates"]), "%Y%m%d").strftime("%Y-%m-%d") if block else None,
                        "holderDate": datetime.strptime(max(holder["dates"]), "%Y%m%d").strftime("%Y-%m-%d") if holder else None,
                        "northDate": None, "northMoney": None,
                        "blockAmount": round(block["amount"], 2) if block else None,
                        "institutionBlockNet": round(block["instNet"], 2) if block else None,
                        "holderNetShares": round(holder["netShares"], 4) if holder else None}
    data["series"] = sorted(by_week.values(), key=lambda row: row["date"])
    data["meta"]["start"] = data["series"][0]["date"]
    data["meta"]["historicalBlockValidation"] = {key: audit[key] for key in ("sourceRows", "includedRows", "excludedNonShSzAShareRows")}
    save("large_money_sentiment_data.json", data)
    print("large money", data["meta"]["start"], flush=True)


def extend_official(token):
    data = load("official_sentiment_data.json")
    existing = {row["date"]: row for row in data["series"]}
    holder_weeks = defaultdict(lambda: {"dates": [], "amount": 0.0})
    for row in years(token, "stk_holdertrade", {}, "ts_code,ann_date,in_de,change_vol,avg_price", 2000, 2017, True):
        date = row.get("ann_date")
        if not date or date >= "20180101" or row.get("avg_price") is None:
            continue
        amount = float(row.get("change_vol") or 0) * float(row["avg_price"]) / 1e8
        item = holder_weeks[week_key(date)]
        item["dates"].append(date)
        item["amount"] += amount if row.get("in_de") == "DE" else -amount
    for item in holder_weeks.values():
        date = datetime.strptime(max(item["dates"]), "%Y%m%d").strftime("%Y-%m-%d")
        existing.setdefault(date, {"date": date})["netReduceAmount"] = round(item["amount"], 4)
    for row in call_api(token, "cn_m", {"start_m": "199001", "end_m": "200512"}, "month,m2_yoy"):
        if row.get("month") and row.get("m2_yoy") is not None:
            month = row["month"]
            import calendar
            date = f"{month[:4]}-{month[4:6]}-{calendar.monthrange(int(month[:4]), int(month[4:6]))[1]:02d}"
            existing.setdefault(date, {"date": date})["m2Yoy"] = round(float(row["m2_yoy"]), 4)
    data["series"] = [existing[date] for date in sorted(existing)]
    data["meta"]["start"] = data["series"][0]["date"]
    save("official_sentiment_data.json", data)
    print("official", data["meta"]["start"], flush=True)


if __name__ == "__main__":
    token = get_token()
    extend_valuation(token)
    extend_retail(token)
    extend_large_money(token)
    extend_official(token)
