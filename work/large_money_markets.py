"""Rebuild comparable SH/SZ institutional series from cached source records."""

import calendar
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime
from holder_trade_corrections import correction_index, identity as correction_identity

from tushare_client import END_DATE, call_api_pages, get_token
from fetch_large_money_sentiment_data import (
    ROOT, OUTPUT, ADJUSTMENTS, aggregate_blocks, apply_adjustments,
    sh_sz_a_share, stock_universe, week_key,
)

CACHE = ROOT / ".tools" / "large-money-markets"
FIELDS = "ts_code,trade_date,price,vol,amount,buyer,seller"


def fetch_cached(token, api, params, fields, size=3000):
    key = hashlib.sha256(json.dumps([api, params, fields], sort_keys=True).encode()).hexdigest()[:20]
    target = CACHE / f"{api}-{params['start_date']}-{params['end_date']}-{key}.json"
    if target.exists() and params["end_date"] < datetime.now().strftime("%Y%m%d"):
        return json.loads(target.read_text())["rows"]
    if api == "block_trade":
        old_key = hashlib.sha256(json.dumps([params, fields], sort_keys=True).encode()).hexdigest()[:16]
        old = ROOT / ".tools" / "large-money-blocks" / f"{params['start_date']}-{params['end_date']}-{old_key}.json"
        if old.exists():
            return json.loads(old.read_text())["rows"]
    rows = call_api_pages(token, api, params, fields, size)
    CACHE.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"api": api, "params": params, "fields": fields,
                                 "fetchedAt": datetime.now().isoformat(), "rows": rows}, ensure_ascii=False))
    return rows


def holder_weeks(rows, corrections=None, audit=None):
    corrections = correction_index() if corrections is None else corrections
    result = defaultdict(lambda: {"dates": [], "sh": 0.0, "sz": 0.0})
    seen = set()
    excluded = 0
    for row in rows:
        if not sh_sz_a_share(row.get("ts_code")):
            excluded += 1
            continue
        identity = tuple(row.get(k) for k in ("ts_code", "ann_date", "holder_name", "in_de", "change_vol", "change_ratio"))
        if identity in seen:
            continue
        seen.add(identity)
        value = row.get("change_vol")
        if not row.get("ann_date") or row.get("in_de") not in ("IN", "DE") or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("Invalid holder change record")
        item = result[week_key(row["ann_date"])]
        item["dates"].append(row["ann_date"])
        correction = corrections.get(correction_identity(row))
        if correction:
            if audit is not None:
                audit.append(correction)
            continue
        item[row["ts_code"][-2:].lower()] += value / 1e8 * (1 if row["in_de"] == "IN" else -1)
    return result, excluded


def north_weeks(rows, issues=None):
    result = {}
    for row in sorted(rows, key=lambda r: r["trade_date"]):
        date = row["trade_date"]
        if date > "20240816":
            continue
        def value(key):
            v = row.get(key)
            if v is None or v == "":
                return None
            number = float(v)
            if not math.isfinite(number):
                raise ValueError(f"Invalid northbound value on {date}")
            return number / 100
        sh, sz, total = value("hgt"), value("sgt"), value("north_money")
        # Shenzhen Connect did not exist before 2016-12-05; its curve remains absent.
        if date < "20161205":
            sz = None
            expected = sh
        else:
            expected = sh + sz if sh is not None and sz is not None else None
        if total is not None and expected is not None and abs(total - expected) > 0.011:
            if issues is not None:
                issues.append({"date": date, "source": row, "reason": "Components disagree with source north_money; excluded, not repaired"})
            sh = sz = expected = None
        result[week_key(date)] = {"date": date, "all": expected, "sh": sh, "sz": sz}
    return result


def iso(date):
    return f"{date[:4]}-{date[4:6]}-{date[6:]}"


def build_series(blocks, stocks, holders, north):
    blocks, adjustments = apply_adjustments(blocks, json.loads(ADJUSTMENTS.read_text()))
    all_blocks, audit = aggregate_blocks(blocks, stocks)
    if audit["validationErrors"]:
        raise ValueError(f"Invalid block records: {len(audit['validationErrors'])}")
    by_market = {market: aggregate_blocks([r for r in blocks if r["ts_code"].endswith('.' + market.upper())], stocks)[0]
                 for market in ("sh", "sz")}
    holder_corrections = []
    holders, excluded = holder_weeks(holders, audit=holder_corrections)
    north_issues = []
    north = north_weeks(north, north_issues)
    output = {market: [] for market in ("all", "sh", "sz")}
    for key in sorted(set(all_blocks) | set(holders) | set(north)):
        block, holder, n = all_blocks.get(key), holders.get(key), north.get(key)
        dates = (block["dates"] if block else []) + (holder["dates"] if holder else []) + ([n["date"]] if n else [])
        for market in output:
            b = block if market == "all" else by_market[market].get(key)
            # A fully fetched week's absence of published trades contributes zero.
            row = {"date": iso(max(dates)),
                   "blockDate": iso(max(block["dates"])) if block else None,
                   "holderDate": iso(max(holder["dates"])) if holder else None,
                   "northDate": iso(n["date"]) if n else None,
                   "blockAmount": round(b["amount"] if b else 0, 2) if block else None,
                   "institutionBlockNet": round(b["instNet"] if b else 0, 2) if block else None,
                   "holderNetShares": round(holder["sh"] + holder["sz"] if market == "all" else holder[market], 4) if holder else None,
                   "northMoney": round(n[market], 2) if n and n[market] is not None else None}
            output[market].append(row)
    return output, {"blockRows": audit["includedRows"], "excludedBlockRows": audit["excludedNonShSzAShareRows"],
                    "excludedHolderRows": excluded, "holderNonTradingCorrections": len(holder_corrections),
                    "adjustments": len(adjustments), "northValidationIssues": north_issues}


def refresh_holders_from_cache():
    """Recompute only holder values at the existing cutoff; preserve all other data."""
    previous = json.loads(OUTPUT.read_text())
    end = previous["meta"]["end"].replace("-", "")
    rows = []
    for year in range(2000, int(end[:4]) + 1):
        year_end = min(f"{year}1231", end)
        paths = list(CACHE.glob(f"stk_holdertrade-{year}0101-{year_end}-*.json"))
        if len(paths) != 1:
            raise ValueError(f"Expected one complete holder cache for {year}: {paths}")
        rows.extend(json.loads(paths[0].read_text())["rows"])
    audit = []
    weeks, _ = holder_weeks(rows, audit=audit)
    changes = []
    for market, series in {"all": previous["series"], **previous["markets"]}.items():
        for row in series:
            holder = weeks.get(week_key(row["date"].replace("-", "")))
            value = round(holder["sh"] + holder["sz"] if market == "all" else holder[market], 4) if holder else None
            if row.get("holderNetShares") != value:
                changes.append({"market": market, "date": row["date"], "before": row.get("holderNetShares"), "after": value})
                row["holderNetShares"] = value
    previous["meta"].setdefault("marketSplit", {})["holderNonTradingCorrections"] = len(audit)
    previous["meta"]["holderCorrections"] = {"reviewedOn": "2026-11-02", "excludedRecords": len(audit),
        "source": "work/holder_trade_adjustments.json",
        "changes": changes or previous["meta"].get("holderCorrections", {}).get("changes", [])}
    OUTPUT.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps({"excludedRecords": len(audit), "changes": changes}, ensure_ascii=False))


def main(blocks_only=False):
    previous = json.loads(OUTPUT.read_text())
    if blocks_only and previous["meta"]["end"].replace("-", "") != END_DATE:
        raise ValueError("For --blocks-only, MARKET_END_DATE must match the existing data end")
    token = get_token()
    stocks = stock_universe(token)
    blocks, holders, north = [], [], []
    for year in range(2000, int(END_DATE[:4]) + 1):
        for month in range(1, 13):
            start = f"{year}{month:02d}01"
            if start > END_DATE:
                break
            end = min(f"{year}{month:02d}{calendar.monthrange(year, month)[1]:02d}", END_DATE)
            blocks.extend(fetch_cached(token, "block_trade", {"start_date": start, "end_date": end}, FIELDS, 1000))
        params = {"start_date": f"{year}0101", "end_date": min(f"{year}1231", END_DATE)}
        if not blocks_only:
            holders.extend(fetch_cached(token, "stk_holdertrade", params,
                                        "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price"))
        if not blocks_only and 2014 <= year <= 2024:
            north.extend(fetch_cached(token, "moneyflow_hsgt", {**params, "end_date": min(params["end_date"], "20240816")},
                                      "trade_date,hgt,sgt,north_money"))
        print(f"market split {year}: {len(blocks)} block / {len(holders)} holder / {len(north)} north records", flush=True)
    series, audit = build_series(blocks, stocks, holders, north)
    if blocks_only:
        for market in series:
            prior = previous["series"] if market == "all" else previous["markets"][market]
            existing = {week_key(row["date"].replace("-", "")): dict(row) for row in prior}
            fresh = {week_key(row["date"].replace("-", "")): row for row in series[market]}
            for key in set(existing) | set(fresh):
                row = existing.setdefault(key, dict(fresh[key])) if key not in existing else existing[key]
                new = fresh.get(key, {})
                for field in ("blockDate", "blockAmount", "institutionBlockNet"):
                    row[field] = new.get(field)
                row["date"] = max(row["date"], new.get("date", row["date"]))
            series[market] = sorted(existing.values(), key=lambda row: row["date"])
        audit["excludedHolderRows"] = previous.get("meta", {}).get("marketSplit", {}).get("excludedHolderRows")
        audit["holderNonTradingCorrections"] = previous.get("meta", {}).get("marketSplit", {}).get("holderNonTradingCorrections", 0)
        audit["northValidationIssues"] = previous.get("meta", {}).get("marketSplit", {}).get("northValidationIssues", [])
    previous["series"] = series.pop("all")
    previous["markets"] = series
    for market, rows in {"all": previous["series"], **series}.items():
        for metric in ("blockAmount", "institutionBlockNet", "holderNetShares", "northMoney"):
            if not any(row.get(metric) is not None for row in rows):
                raise ValueError(f"No valid {market}/{metric} observations; refusing to publish")
    previous["meta"].update({"start": previous["series"][0]["date"], "end": previous["series"][-1]["date"],
                              "updated": datetime.now().strftime("%Y-%m-%d"),
                              "marketSplit": {"requestedEnd": END_DATE, "scope": "Shanghai/Shenzhen A shares; northbound by Connect channel",
                                              "northShStart": "2014-11-17", "northSzStart": "2016-12-05", **audit}})
    OUTPUT.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(previous["meta"]["marketSplit"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--holders-from-cache", action="store_true")
    if parser.parse_args().holders_from_cache:
        refresh_holders_from_cache()
    else:
        main()
