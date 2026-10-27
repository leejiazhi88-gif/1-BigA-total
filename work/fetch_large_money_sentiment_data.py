import calendar
import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from tushare_client import END_DATE, call_api, call_api_pages, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "large_money_sentiment_data.json"
START_YEAR = 2018
END_YEAR = int(END_DATE[:4])
CACHE = ROOT / ".tools" / "large-money-blocks"
AUDIT_FILE = ROOT / "outputs" / "block-trade-audit.json"
ADJUSTMENTS = ROOT / "work" / "block_trade_adjustments.json"



def month_ranges():
    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            if year == END_YEAR and month > int(END_DATE[4:6]):
                return
            last = calendar.monthrange(year, month)[1]
            end = f"{year}{month:02d}{last:02d}"
            if year == END_YEAR and month == int(END_DATE[4:6]):
                end = END_DATE
            yield f"{year}{month:02d}01", end


def week_key(date):
    dt = datetime.strptime(date, "%Y%m%d")
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def week_end_date(dates):
    return max(dates)


def sh_sz_a_share(code):
    return bool(re.fullmatch(r"(?:60\d{4}|68\d{4})\.SH|(?:00\d{4}|30\d{4})\.SZ", code or ""))


def stock_universe(token):
    stocks = {}
    for exchange in ("SSE", "SZSE"):
        for status in ("L", "D", "P"):
            rows = call_api_pages(token, "stock_basic", {"exchange": exchange, "list_status": status},
                                 "ts_code,name,list_date,delist_date", 6000)
            stocks.update({r["ts_code"]: r for r in rows if sh_sz_a_share(r["ts_code"])})
    if not stocks:
        raise ValueError("No A-share security master returned")
    return stocks


def checked_block_amount(row):
    for field in ("price", "vol", "amount"):
        value = row.get(field)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError(f"Invalid block {field}: {row['trade_date']} {row['ts_code']}")
    expected = row["price"] * row["vol"]
    # Price is yuan/share, volume is ten-thousand shares, so amount is ten-thousand yuan.
    tolerance = max(0.02, row["price"] * 0.005 + row["vol"] * 0.005 + 0.005025, expected * 0.002)
    if abs(row["amount"] - expected) > tolerance:
        raise ValueError(f"Block price/volume/amount mismatch: {row['trade_date']} {row['ts_code']}")
    return row["amount"] / 10000


def apply_adjustments(blocks, adjustments):
    applied = []
    corrected = []
    for row in blocks:
        match = next((item for item in adjustments if row == item["original"]), None)
        if match:
            corrected.append({**row, **match["replacement"]})
            applied.append(match)
        else:
            corrected.append(row)
    return corrected, applied


def aggregate_blocks(blocks, stocks):
    weeks = defaultdict(lambda: {"dates": [], "amount": 0.0, "instNet": 0.0})
    excluded = Counter()
    excluded_examples, errors = [], []
    included_count = 0
    for row in blocks:
        code, date = row["ts_code"], row["trade_date"]
        if not sh_sz_a_share(code):
            excluded[code.split(".")[0][:3] + "." + code.split(".")[-1]] += 1
            if row.get("amount") is not None:
                excluded_examples.append(row)
            continue
        stock = stocks.get(code)
        if not stock or not stock.get("list_date") or stock["list_date"] > date or (stock.get("delist_date") and stock["delist_date"] <= date):
            errors.append({"reason": "A-share identity or listing date not verified", "row": row})
            continue
        try:
            amount = checked_block_amount(row)
        except ValueError as error:
            errors.append({"reason": str(error), "row": row})
            continue
        included_count += 1
        item = weeks[week_key(date)]
        item["dates"].append(date)
        item["amount"] += amount
        buyer_inst = "机构专用" in str(row.get("buyer") or "")
        seller_inst = "机构专用" in str(row.get("seller") or "")
        item["instNet"] += amount * (int(buyer_inst) - int(seller_inst))
    audit = {"sourceRows": len(blocks), "includedRows": included_count,
             "excludedNonShSzAShareRows": sum(excluded.values()), "excludedCodePrefixes": dict(sorted(excluded.items())),
             "largestExcludedRows": sorted(excluded_examples, key=lambda r: r["amount"], reverse=True)[:10],
             "validationErrors": errors}
    return weeks, audit


def fetch_block_weeks(token):
    stocks = stock_universe(token)
    blocks = []
    fields = "ts_code,trade_date,price,vol,amount,buyer,seller"
    for start, end in month_ranges():
        params = {"start_date": start, "end_date": end}
        key = hashlib.sha256(json.dumps([params, fields], sort_keys=True).encode()).hexdigest()[:16]
        target = CACHE / f"{start}-{end}-{key}.json"
        if target.exists() and start[:6] < END_DATE[:6]:
            rows = json.loads(target.read_text(encoding="utf-8"))["rows"]
        else:
            rows = call_api_pages(token, "block_trade", params, fields, 1000)
            CACHE.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps({"api": "block_trade", "params": params, "fields": fields,
                                          "fetchedAt": datetime.now().isoformat(), "rows": rows}, ensure_ascii=False), encoding="utf-8")
        blocks.extend(rows)
        print(json.dumps({"blockMonth": start[:6], "rows": len(rows)}), flush=True)
    blocks, adjustments = apply_adjustments(blocks, json.loads(ADJUSTMENTS.read_text(encoding="utf-8")))
    weeks, audit = aggregate_blocks(blocks, stocks)
    audit.update({"checkedAt": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
                  "scope": "Shanghai/Shenzhen A shares, including formerly listed stocks; excludes bonds, funds, B shares and Beijing",
                  "amountUnit": "亿元", "conversion": "amount (万元) / 10000; checked against price * vol (万股)",
                  "stockMasterCount": len(stocks),
                  "adjustments": adjustments,
                  "weeks": [{"week": key, "date": max(value["dates"]), "amountYi": round(value["amount"], 2),
                             "institutionNetYi": round(value["instNet"], 2)} for key, value in sorted(weeks.items())]})
    AUDIT_FILE.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    if audit["validationErrors"]:
        raise ValueError(f"{len(audit['validationErrors'])} block validation errors; see {AUDIT_FILE}")
    return weeks, audit


def block_metadata(audit):
    return {"checkedAt": audit["checkedAt"], "scope": audit["scope"], "conversion": audit["conversion"],
            "includedRows": audit["includedRows"], "excludedNonShSzAShareRows": audit["excludedNonShSzAShareRows"],
            "audit": "outputs/block-trade-audit.json"}


def replace_block_series(data, weeks):
    existing = {week_key(row["date"].replace("-", "")): row for row in data["series"]}
    rows = []
    for key in sorted(set(existing) | set(weeks)):
        row = dict(existing.get(key, {}))
        block = weeks.get(key)
        date = datetime.strptime(max(block["dates"]), "%Y%m%d").strftime("%Y-%m-%d") if block else None
        row.update({"blockDate": date, "blockAmount": round(block["amount"], 2) if block else None,
                    "institutionBlockNet": round(block["instNet"], 2) if block else None})
        row["date"] = max(filter(None, [row.get("date"), date]))
        rows.append(row)
    return rows


def main(blocks_only=False):
    token = get_token()
    block_weeks, block_audit = fetch_block_weeks(token)
    if blocks_only:
        result = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if result["meta"]["end"].replace("-", "") != END_DATE:
            raise ValueError("For --blocks-only, MARKET_END_DATE must match the existing data end")
        result["series"] = replace_block_series(result, block_weeks)
        result["meta"]["blockValidation"] = block_metadata(block_audit)
        result["meta"]["updated"] = datetime.now().strftime("%Y-%m-%d")
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(json.dumps({"output": str(OUTPUT), "blockValidation": result["meta"]["blockValidation"]}, ensure_ascii=False))
        return
    north = call_api(
        token,
        "moneyflow_hsgt",
        {"start_date": f"{START_YEAR}0101", "end_date": "20240816"},
        "trade_date,north_money",
    )
    holder_trades = []
    for start, end in month_ranges():
        holder_trades.extend(
            call_api_pages(
                token,
                "stk_holdertrade",
                {"start_date": start, "end_date": end},
                "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price",
                page_size=3000,
            )
        )

    unique_holder_rows = {}
    for row in holder_trades:
        identity = (
            row.get("ts_code"),
            row.get("ann_date"),
            row.get("holder_name"),
            row.get("in_de"),
            row.get("change_vol"),
            row.get("change_ratio"),
        )
        unique_holder_rows[identity] = row
    holder_weeks = defaultdict(lambda: {"dates": [], "netShares": 0.0})
    for row in unique_holder_rows.values():
        date = row.get("ann_date")
        if not date:
            continue
        key = week_key(date)
        shares = float(row.get("change_vol") or 0) / 1e8
        signed = shares if row.get("in_de") == "IN" else -shares
        holder_weeks[key]["dates"].append(date)
        holder_weeks[key]["netShares"] += signed

    north_weeks = {}
    for row in sorted(north, key=lambda item: item["trade_date"]):
        key = week_key(row["trade_date"])
        north_weeks[key] = {
            "date": row["trade_date"],
            "northMoney": float(row.get("north_money") or 0) / 100,
        }

    keys = sorted(set(block_weeks) | set(holder_weeks) | set(north_weeks))
    series = []
    for key in keys:
        dates = []
        if key in block_weeks:
            dates.extend(block_weeks[key]["dates"])
        if key in holder_weeks:
            dates.extend(holder_weeks[key]["dates"])
        if key in north_weeks:
            dates.append(north_weeks[key]["date"])
        date = week_end_date(dates)
        block = block_weeks.get(key, {})
        holder = holder_weeks.get(key, {})
        north_row = north_weeks.get(key, {})
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "blockDate": datetime.strptime(max(block["dates"]), "%Y%m%d").strftime("%Y-%m-%d") if block else None,
                "holderDate": datetime.strptime(max(holder["dates"]), "%Y%m%d").strftime("%Y-%m-%d") if holder else None,
                "northDate": datetime.strptime(north_row["date"], "%Y%m%d").strftime("%Y-%m-%d") if north_row else None,
                "northMoney": round(north_row["northMoney"], 2)
                if "northMoney" in north_row
                else None,
                "blockAmount": round(block["amount"], 2) if block else None,
                "institutionBlockNet": round(block["instNet"], 2) if block else None,
                "holderNetShares": round(holder["netShares"], 4) if holder else None,
            }
        )

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "start": series[0]["date"],
            "end": series[-1]["date"],
            "northEnd": "2024-08-16",
            "blockValidation": block_metadata(block_audit),
            "sources": {
                "north": "Tushare moneyflow_hsgt",
                "block": "Tushare block_trade",
                "holder": "Tushare stk_holdertrade",
            },
        },
        "series": series,
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(OUTPUT), "points": len(series)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--blocks-only", action="store_true", help="Rebuild block metrics while retaining other cached series")
    main(parser.parse_args().blocks_only)
