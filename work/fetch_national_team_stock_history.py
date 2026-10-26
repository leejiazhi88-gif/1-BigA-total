"""Backfill disclosed national-team A-share holdings, retaining source audits."""

import argparse
import hashlib
import json
import re
import subprocess
import time
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from tushare_client import call_api, get_token


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools" / "national-team-stock-history"
PREVIOUS = ROOT / ".tools" / "national-team-comparison"
OUTPUT = ROOT / "work" / "national_team_stock_history.json"
HUJIN = "中央汇金投资有限责任公司"
ACCOUNTS = (HUJIN, "中央汇金资产管理有限责任公司", "中国证券金融股份有限公司")
ALIASES = {"汇金公司": HUJIN, "中央汇金投资有限公司": HUJIN,
           "中国证券金融公司": ACCOUNTS[2], "证金公司": ACCOUNTS[2]}
HOLDER_FIELDS = "ts_code,ann_date,end_date,holder_name,hold_amount,hold_ratio,holder_type"


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_account(name):
    return ALIASES.get(name, name)


def identified_account(name):
    name = normalize_account(name or "")
    return any(account in name for account in ACCOUNTS) or "中国证金" in name


def a_share(code):
    return bool(re.fullmatch(r"(?:60\d{4}|68\d{4})\.SH|(?:00\d{4}|30\d{4})\.SZ|(?:[48]\d{5}|92\d{4})\.BJ", code))


def periods_between(start, end):
    return [f"{year}{suffix}" for year in range(int(start[:4]), int(end[:4]) + 1)
            for suffix in ("0331", "0630", "0930", "1231") if start <= f"{year}{suffix}" <= end]


def api_cached(token, name, params, fields, filename, reuse=False):
    target = CACHE / filename
    if target.exists():
        return read(target)
    if reuse and (PREVIOUS / filename).exists():
        result = read(PREVIOUS / filename)
    else:
        result = call_api(token, name, params, fields)
        time.sleep(0.25)
    save(target, result)
    return result


def api_pages(token, name, params, fields, prefix, reuse=False):
    rows, signatures, offset = [], set(), 0
    while True:
        page = api_cached(token, name, {**params, "limit": 6000, "offset": offset}, fields,
                          f"{prefix}-{offset}.json", reuse)
        signature = hashlib.sha256(json.dumps(page, sort_keys=True).encode()).hexdigest()
        if page and signature in signatures:
            raise ValueError(f"Repeated pagination: {prefix} offset={offset}")
        signatures.add(signature)
        rows.extend(page)
        if len(page) < 6000:
            return rows
        offset += len(page)


def select_disclosed(rows, period, as_of):
    usable = [r for r in rows if r.get("end_date") == period and r.get("ann_date")
              and r["ann_date"] <= as_of and a_share(r["ts_code"])]
    latest = {}
    for row in usable:
        latest[row["ts_code"]] = max(latest.get(row["ts_code"], ""), row["ann_date"])
    selected = {}
    for row in usable:
        if row["ann_date"] != latest[row["ts_code"]] or not identified_account(row["holder_name"]):
            continue
        key = (row["ts_code"], normalize_account(row["holder_name"]))
        if key in selected and selected[key]["hold_amount"] != row["hold_amount"]:
            raise ValueError(f"Conflicting disclosed holding: {period} {key}")
        selected[key] = {**row, "holder_name": key[1]}
    return list(selected.values()), len(latest)


def web_json(url, filename):
    target = CACHE / filename
    if target.exists():
        return read(target)
    for attempt in range(3):
        response = subprocess.run(["curl", "-fsSL", "--connect-timeout", "10", "--max-time", "30",
                                   "-H", "Referer: https://data.eastmoney.com/", url],
                                  capture_output=True, text=True)
        if response.returncode == 0:
            result = json.loads(response.stdout)
            if result.get("success") is not False:
                save(target, result)
                return result
            if result.get("code") != 9701:
                raise ValueError(f"Source rejected request: {result.get('message')}")
        if attempt < 2:
            time.sleep(attempt + 1)
    raise RuntimeError(f"Source request failed: {filename}")


def audit(args):
    summary = []
    for period in periods_between(args.start, args.end):
        screened_path = CACHE / f"screened-{period}.json"
        if not screened_path.exists():
            print("awaiting_collection", period, flush=True)
            break
        screened = read(screened_path)
        names = sorted({r["holder_name"] for r in screened["matched"]} | set(ALIASES))
        date = f"{period[:4]}-{period[4:6]}-{period[6:]}"
        holder_filter = ",".join('"' + name + '"' for name in names)
        rows, page, total, signatures = [], 1, None, set()
        while True:
            params = {"reportName": "RPT_DMSK_HOLDERS", "columns": "ALL", "pageSize": 50,
                      "pageNumber": page, "sortColumns": "SECURITY_CODE,RANK", "sortTypes": "1,1",
                      "filter": f"(END_DATE='{date}')(HOLDER_NAME in ({holder_filter}))"}
            url = "https://datacenter-web.eastmoney.com/api/data/v1/get?" + urllib.parse.urlencode(params)
            result = web_json(url, f"share-class-{period}-{page}.json")["result"]
            if total is not None and total != result["count"]:
                raise ValueError(f"Source changed during pagination: {period}")
            total = result["count"]
            signature = hashlib.sha256(json.dumps(result["data"], sort_keys=True).encode()).hexdigest()
            if signature in signatures:
                raise ValueError(f"Repeated source page: {period}")
            signatures.add(signature)
            rows.extend(result["data"])
            if page >= result["pages"]:
                break
            page += 1
        if len(rows) != total:
            raise ValueError(f"Incomplete source pages: {period}")
        save(CACHE / f"share-class-{period}.json", rows)
        by_key = defaultdict(list)
        for row in rows:
            if a_share(row["SECUCODE"]):
                by_key[(row["SECUCODE"], normalize_account(row["HOLDER_NAME"]))].append(row)
        missing, mismatches, mixed, price_differences = [], [], [], []
        for row in screened["matched"]:
            key = (row["ts_code"], row["holder_name"])
            candidates = by_key.get(key, [])
            matches = [r for r in candidates if abs(r["HOLD_NUM"] - row["hold_amount"]) < 1]
            if not matches:
                (mismatches if candidates else missing).append({"row": row, "source": candidates})
                continue
            check = matches[-1]
            if "H" in (check["SHARES_TYPE"] or "") or "B" in (check["SHARES_TYPE"] or ""):
                mixed.append({"row": row, "source": check})
            price = screened["prices"].get(row["ts_code"])
            if price and check.get("REFERENCE_MARKET_CAP"):
                implied = check["REFERENCE_MARKET_CAP"] / check["HOLD_NUM"]
                if abs(price["close"] - implied) > 0.011:
                    price_differences.append({"code": row["ts_code"], "close": price, "reference": implied})
        matched_keys = {(r["ts_code"], r["holder_name"]) for r in screened["matched"]}
        additional = [r for k, values in by_key.items() if k not in matched_keys for r in values
                      if identified_account(r["HOLDER_NAME"])]
        result = {"period": period, "source_rows": len(rows), "missing": missing, "mismatches": mismatches,
                  "mixed_shares": mixed, "price_differences": price_differences, "additional": additional}
        save(CACHE / f"audit-{period}.json", result)
        status = {k: len(v) if isinstance(v, list) else v for k, v in result.items()}
        summary.append(status)
        print(json.dumps(status, ensure_ascii=False), flush=True)
    save(CACHE / "audit-summary.json", summary)


def collect(args):
    token = get_token()
    basic = []
    for status in ("L", "D", "P"):
        basic.extend(api_pages(token, "stock_basic", {"list_status": status},
                               "ts_code,name,list_date,delist_date,market", "stock-basic-" + status))
    save(CACHE / "stock-names.json", {r["ts_code"]: r for r in basic})
    calendar = api_cached(token, "trade_cal", {"exchange": "SSE", "start_date": args.start,
                          "end_date": args.end}, "cal_date,is_open,pretrade_date", f"calendar-{args.start}-{args.end}.json")
    dates = {r["cal_date"]: r["cal_date"] if r["is_open"] else r["pretrade_date"] for r in calendar}
    summary, discovered = [], Counter()
    for period in periods_between(args.start, args.end):
        rows = api_pages(token, "top10_holders", {"period": period}, HOLDER_FIELDS, "holders-" + period, True)
        matched, coverage = select_disclosed(rows, period, args.as_of)
        for row in rows:
            if any(word in row["holder_name"] for word in ("汇金", "证金", "证券金融", "中证金融")):
                discovered[row["holder_name"]] += 1
        trade_date = dates[period]
        prices = api_pages(token, "daily", {"trade_date": trade_date}, "ts_code,trade_date,close", "prices-" + trade_date)
        prices = {r["ts_code"]: r for r in prices}
        missing = sorted({r["ts_code"] for r in matched} - prices.keys())
        for code in missing:
            cached = CACHE / f"price-fallback-{code}-{period}-0.json"
            if cached.exists() and read(cached):
                prices[code] = max(read(cached), key=lambda r: r["trade_date"])
        snapshot = {"period": period, "as_of": args.as_of, "market_close_date": trade_date,
                    "source_rows": len(rows), "source_companies": coverage, "matched": matched,
                    "prices": {r["ts_code"]: prices.get(r["ts_code"]) for r in matched}}
        save(CACHE / f"screened-{period}.json", snapshot)
        status = {"period": period, "source_companies": coverage, "matched_companies": len(snapshot["prices"]),
                  "holdings": len(matched), "stale_prices": len(missing),
                  "missing_prices": [k for k, v in snapshot["prices"].items() if v is None]}
        summary.append(status)
        print(json.dumps(status, ensure_ascii=False), flush=True)
    save(CACHE / "discovered-accounts.json", dict(discovered.most_common()))
    save(CACHE / "collection-summary.json", summary)


def eligible_stock(code, period, basic):
    row = basic.get(code)
    return (a_share(code) and row is not None and bool(row.get("list_date"))
            and row["list_date"] <= period and (not row.get("delist_date") or row["delist_date"] > period))


def canonical_holdings(rows, period, as_of, basic):
    selected, excluded = {}, []
    for row in rows:
        code, holder = row["SECUCODE"], normalize_account(row["HOLDER_NAME"])
        if not eligible_stock(code, period, basic) or not identified_account(holder) or "担保证券账户" in holder:
            excluded.append({"code": code, "holder": holder, "reason": "outside_listed_A_share_or_account_scope"})
            continue
        announced = (row.get("NOTICE_DATE") or "")[:10].replace("-", "")
        if not announced or announced > as_of or row["END_DATE"][:10].replace("-", "") != period:
            excluded.append({"code": code, "holder": holder, "reason": "outside_disclosure_window"})
            continue
        key = (code, holder)
        old = selected.get(key)
        if old and old["NOTICE_DATE"] == row["NOTICE_DATE"] and old["HOLD_NUM"] != row["HOLD_NUM"]:
            raise ValueError(f"Conflicting primary source rows: {period} {key}")
        if old is None or old["NOTICE_DATE"] < row["NOTICE_DATE"]:
            selected[key] = row
    return selected, excluded


def export(args):
    basic = read(CACHE / "stock-names.json")
    corrections = read(ROOT / "work" / "national_team_stock_adjustments.json")
    snapshots, failures = {}, []
    for period in periods_between(args.start, args.end):
        screened = read(CACHE / f"screened-{period}.json")
        raw = read(CACHE / f"share-class-{period}.json")
        holdings, excluded = canonical_holdings(raw, period, args.as_of, basic)
        ts_rows = {(r["ts_code"], r["holder_name"]): r for r in screened["matched"]}
        prices = {r["ts_code"]: r for p in CACHE.glob(f'prices-{screened["market_close_date"]}-*.json') for r in read(p)}
        details, differences = [], []
        for (code, holder), row in holdings.items():
            units = row["HOLD_NUM"]
            share_class = row["SHARES_TYPE"] or ""
            adjustment = None
            if "H" in share_class or "B" in share_class:
                adjustment = corrections.get(period + ":" + code + ":" + holder)
                if not adjustment or adjustment["a_shares"] + adjustment["h_shares"] != units:
                    failures.append({"period": period, "code": code, "holder": holder, "reason": "unresolved_share_class"})
                    continue
                units = adjustment["a_shares"]
            elif not any(label in share_class for label in ("A股", "流通股", "国家股", "人民币普通股")):
                failures.append({"period": period, "code": code, "reason": "unknown_share_class", "value": share_class})
                continue
            price = prices.get(code)
            reference = row.get("REFERENCE_MARKET_CAP")
            implied = reference / row["HOLD_NUM"] if reference and row["HOLD_NUM"] else None
            if price is not None:
                close, price_source = price["close"], "Tushare daily"
                if implied is not None and abs(close - implied) > 0.011:
                    failures.append({"period": period, "code": code, "reason": "period_price_mismatch", "daily": close, "reference": implied})
                    continue
            elif implied and implied > 0:
                close, price_source = round(implied, 4), "Eastmoney period-end reference"
            else:
                failures.append({"period": period, "code": code, "reason": "missing_period_price"})
                continue
            ts = ts_rows.get((code, holder))
            crosschecked = ts is not None and abs(ts["hold_amount"] - row["HOLD_NUM"]) < 1
            if not crosschecked:
                differences.append({"code": code, "holder": holder, "source_units": row["HOLD_NUM"],
                                    "tushare_units": ts["hold_amount"] if ts else None})
            detail = {"ts_code": code, "stock_name": row["SECURITY_NAME_ABBR"], "holder_name": holder,
                      "end_date": period, "ann_date": row["NOTICE_DATE"][:10].replace("-", ""),
                      "hold_amount": row["HOLD_NUM"], "a_share_amount": units, "share_class": share_class,
                      "close": close, "price_date": screened["market_close_date"], "price_source": price_source,
                      "value_yi": units * close / 1e8, "units_crosschecked": crosschecked,
                      "source_url": f'https://data.eastmoney.com/gdfx/stock/{code[:6]}.html'}
            if adjustment:
                detail.update(excluded_h_shares=adjustment["h_shares"], adjustment_source=adjustment["source"])
            details.append(detail)
        totals = defaultdict(float)
        for row in details:
            totals[row["holder_name"]] += row["value_yi"]
        snapshots[period] = {"period": period, "stock_count": len({r["ts_code"] for r in details}),
                             "holder_rows": len(details), "total_yi": sum(r["value_yi"] for r in details),
                             "huijin_investment_yi": totals[HUJIN],
                             "other_identified_accounts_yi": sum(v for k, v in totals.items() if k != HUJIN),
                             "by_holder_yi": dict(totals), "details": sorted(details, key=lambda r: -r["value_yi"]),
                             "coverage": {"primary_source_rows": len(raw), "crosschecked_rows": sum(r["units_crosschecked"] for r in details),
                                          "reference_price_rows": sum(r["price_source"] != "Tushare daily" for r in details)},
                             "source_differences": differences, "excluded": excluded}
        print(period, len(details), round(snapshots[period]["total_yi"], 2), "unresolved", len(failures), flush=True)
    if failures:
        save(CACHE / "export-failures.json", failures)
        raise ValueError(f"Unresolved source audit: {len(failures)} entries; see export-failures.json")
    previous = read(ROOT / "outputs" / "national-team-holdings-comparison-20261026.json")
    for period, old in previous["stocks"].items():
        if period in snapshots:
            current = snapshots[period]
            if abs(current["total_yi"] - old["total_yi"]) > 0.01 or current["holder_rows"] != old["holder_rows"]:
                raise ValueError(f"Overlapping audit differs: {period}")
    save(OUTPUT, {"checked_at": args.as_of[:4] + "-" + args.as_of[4:6] + "-" + args.as_of[6:],
                  "source": "Eastmoney RPT_DMSK_HOLDERS (top ten shareholders), crosschecked with Tushare top10_holders/daily and CCB reports",
                  "unit": "CNY 100 million", "start": args.start, "end": args.end,
                  "scope": "Central Huijin Investment, Central Huijin Asset Management, China Securities Finance and explicit full-name mandates; excludes anonymous plans and securities lending collateral accounts",
                  "failures": [], "stocks": snapshots})
    lines = ["# 国家队直接A股历史核查", "", f"核查截至 {args.as_of}，报告期 {args.start} 至 {args.end}，共 {len(snapshots)} 个季度。金额单位：亿元。", "",
             "## 统一口径", "",
             "- 采用东方财富 RPT_DMSK_HOLDERS 各期前十大股东表；Tushare top10_holders 用于交叉核对，不将其早期混入的前十大流通股东条目并入。",
             "- 识别中央汇金投资、中央汇金资管、中国证券金融及包含这些机构全称的明确委托账户。未扩展到其他国资、中证金融计划或转融通担保证券账户。",
             "- 仅保留报告期当时已上市、尚未退市的A股普通股代码，避免B股副本和上市前记录重复统计；按股票、股东及最新可用公告去重。",
             "- 正常交易采用期末最后交易日Tushare未复权收盘价，并与东方财富参考市值反算价核对；停牌等缺少当日行情时采用东方财富期末参考市值折算价，页面以＊标记。",
             "- 建行汇金A/H股逐期拆分，45份原始季度/中期/年度报告的证据、链接和股数见 work/national_team_stock_adjustments.json。",
             "- 2025年底、2026年中金额及账户条数与之前独立核算完全衔接。图上变化含估值、持股变化及股东榜覆盖变化，不能等同净买卖额。", "",
             "## 各期汇总", "", "| 报告期 | 直接A股 | 汇金投资 | 其他账户 | 公司数 | 持仓条数 | 股数双源一致 | 期末参考价条数 |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for period, row in snapshots.items():
        lines.append(f'| {period} | {row["total_yi"]:,.2f} | {row["huijin_investment_yi"]:,.2f} | {row["other_identified_accounts_yi"]:,.2f} | {row["stock_count"]} | {row["holder_rows"]} | {row["coverage"]["crosschecked_rows"]} | {row["coverage"]["reference_price_rows"]} |')
    lines += ["", "## 来源差异与限制", "",
              "不同接口的早期覆盖和个别股数有差异，因此不宣称所有历史明细均双源一致。每条明细保留 units_crosschecked，差异列表保存在 JSON 的 source_differences。主表采用明确的前十大股东原始类型，价格不一致、未知股份类别和缺价会阻止发布。",
              "例如2015Q3华数传媒原始季报将汇金列在前十大流通股东，未列在前十大股东中；不并入主表。江铃汽车2017年底/2018Q1和建行汇金资管2020Q1的股数以主表为准，保留与Tushare的差异，不静默混用。",
              "前十门槛之外未披露的持股不等于零；公司数量是本口径可识别公司数，非国家队真实持股范围。未纳入的中证金融计划可能使2015等时期的已识别金额低于更宽口径统计。", "",
              "- [华数传媒2015Q3原报告](https://data.eastmoney.com/notices/detail/000156/AN201510300011241936.html)",
              "- [Tushare前十大股东说明](https://tushare.pro/document/2?doc_id=61)",
              "- [Tushare日行情说明](https://tushare.pro/document/2?doc_id=27)",
              "- [历史明细及各期覆盖](../work/national_team_stock_history.json)",
              "- [建行A/H股拆分与原报告](../work/national_team_stock_adjustments.json)", ""]
    (ROOT / "outputs" / "national-team-stock-history-audit.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="20150630")
    parser.add_argument("--end", default="20260630")
    parser.add_argument("--as-of", default="20261026")
    parser.add_argument("--stage", choices=("collect", "audit", "export"), default="collect")
    args = parser.parse_args()
    for value in (args.start, args.end, args.as_of):
        datetime.strptime(value, "%Y%m%d")
    if args.start > args.end or args.end > args.as_of:
        raise ValueError("Invalid date range")
    {"collect": collect, "audit": audit, "export": export}[args.stage](args)


if __name__ == "__main__":
    main()
