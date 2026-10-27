"""Build disclosed A-share holdings of named national social security portfolios."""

import argparse
import hashlib
import json
import math
import re
import urllib.parse
from datetime import datetime

from fetch_national_team_stock_history import (
    CACHE, ROOT, HOLDER_FIELDS, api_cached, api_pages, eligible_stock,
    get_token, periods_between, read, save, web_json,
)

OUTPUT = ROOT / "work" / "social_security_history.json"
DIGITS = str.maketrans("零〇一二三四五六七八九", "00123456789")
NUMBER = r"[零〇一二三四五六七八九0-9]{3,5}"


def portfolio_key(name):
    name = re.sub(r"\s+", "", name or "")
    match = re.fullmatch(r"全国社保基金(" + NUMBER + r")组合", name)
    if not match:
        match = re.fullmatch(r"(?:.+(?:基金管理|证券).*公司|中国国际金融股份有限公司)[-－—](?:全国)?社保基金(" + NUMBER + r")组合", name)
    return "social-" + match[1].translate(DIGITS) if match else None


def fetch_primary(period, extra_names=()):
    date = f"{period[:4]}-{period[4:6]}-{period[6:]}"
    clause = '(HOLDER_NEWTYPE="社保")' if not extra_names else '(HOLDER_NAME in (' + ','.join('"' + n + '"' for n in extra_names) + '))'
    identity = hashlib.sha256(clause.encode()).hexdigest()[:12]
    rows, signatures, count, page = [], set(), None, 1
    while True:
        params = {"reportName": "RPT_DMSK_HOLDERS", "columns": "ALL", "pageSize": 50,
                  "pageNumber": page, "sortColumns": "SECURITY_CODE,RANK", "sortTypes": "1,1",
                  "filter": f"(END_DATE='{date}')" + clause}
        url = "https://datacenter-web.eastmoney.com/api/data/v1/get?" + urllib.parse.urlencode(params)
        try:
            response = web_json(url, f"social-primary-{period}-{identity}-{page}.json")
        except ValueError as error:
            if extra_names and page == 1 and str(error) == "Source rejected request: 返回数据为空":
                return []
            raise
        result = response.get("result")
        if result is None:
            if response.get("code") == 9201:
                return []
            raise ValueError(f"No source result for {period}")
        if count is not None and count != result["count"]:
            raise ValueError(f"Primary source changed during pagination: {period}")
        count = result["count"]
        batch = result.get("data") or []
        signature = hashlib.sha256(json.dumps(batch, sort_keys=True).encode()).hexdigest()
        if signature in signatures:
            raise ValueError(f"Repeated primary source page: {period}")
        signatures.add(signature)
        rows.extend(batch)
        if page >= result["pages"]:
            break
        page += 1
    if len(rows) != count:
        raise ValueError(f"Incomplete primary source: {period}")
    return rows


def select_holdings(rows, period, as_of, basic):
    selected, excluded = {}, []
    for row in rows:
        code, name = row["SECUCODE"], row["HOLDER_NAME"]
        account = portfolio_key(name)
        notice = (row.get("NOTICE_DATE") or "")[:10].replace("-", "")
        if not account or not eligible_stock(code, period, basic):
            excluded.append({"code": code, "holder": name, "reason": "outside_portfolio_or_listed_A_share_scope"})
            continue
        if not notice or notice > as_of or row["END_DATE"][:10].replace("-", "") != period:
            excluded.append({"code": code, "holder": name, "reason": "outside_disclosure_window"})
            continue
        key = (code, account)
        previous = selected.get(key)
        if previous and previous["NOTICE_DATE"] == row["NOTICE_DATE"] and previous["HOLD_NUM"] != row["HOLD_NUM"]:
            raise ValueError(f"Conflicting portfolio shares: {period} {key}")
        if previous is None or previous["NOTICE_DATE"] < row["NOTICE_DATE"]:
            selected[key] = row
    return selected, excluded


def holding_value(row, price):
    units = row.get("HOLD_NUM")
    share_class = row.get("SHARES_TYPE") or ""
    if not isinstance(units, (int, float)) or not math.isfinite(units) or units <= 0:
        raise ValueError("invalid_share_amount")
    if "H" in share_class or "B" in share_class or not any(s in share_class for s in ("A股", "流通股", "人民币普通股")):
        raise ValueError("unverified_share_class: " + share_class)
    reference = row.get("REFERENCE_MARKET_CAP")
    implied = reference / units if reference and reference > 0 else None
    if price is not None:
        close, source = price["close"], "Tushare daily"
        if implied is not None and abs(close - implied) > 0.011:
            raise ValueError(f"period_price_mismatch: {close} vs {implied}")
    elif implied is not None:
        close, source = round(implied, 4), "Eastmoney period-end reference"
    else:
        raise ValueError("missing_period_price")
    if not math.isfinite(close) or close <= 0:
        raise ValueError("invalid_period_price")
    return close, source, units * close / 1e8


def build(args):
    token = get_token()
    basic = {r["ts_code"]: r for status in ("L", "D", "P")
             for r in api_pages(token, "stock_basic", {"list_status": status},
                                "ts_code,name,list_date,delist_date,market", "stock-basic-" + status)}
    calendar = api_cached(token, "trade_cal", {"exchange": "SSE", "start_date": args.start, "end_date": args.end},
                          "cal_date,is_open,pretrade_date", f"calendar-{args.start}-{args.end}.json")
    dates = {r["cal_date"]: r["cal_date"] if r["is_open"] else r["pretrade_date"] for r in calendar}
    snapshots, failures = {}, []
    for period in periods_between(args.start, args.end):
        raw_ts = api_pages(token, "top10_holders", {"period": period}, HOLDER_FIELDS, "holders-" + period, True)
        ts = [r for r in raw_ts if r.get("end_date") == period and r.get("ann_date") and r["ann_date"] <= args.as_of]
        latest = {}
        for row in ts:
            latest[row["ts_code"]] = max(latest.get(row["ts_code"], ""), row["ann_date"])
        ts = [r for r in ts if r["ann_date"] == latest[r["ts_code"]] and portfolio_key(r["holder_name"])
              and eligible_stock(r["ts_code"], period, basic)]
        primary = fetch_primary(period)
        known = {r["HOLDER_NAME"] for r in primary}
        extra = sorted({r["holder_name"] for r in ts} - known)
        for offset in range(0, len(extra), 10):
            primary.extend(fetch_primary(period, extra[offset:offset + 10]))
        holdings, excluded = select_holdings(primary, period, args.as_of, basic)
        trade_date = dates[period]
        prices = {r["ts_code"]: r for r in api_pages(token, "daily", {"trade_date": trade_date},
                                                   "ts_code,trade_date,close", "prices-" + trade_date)}
        details, differences = [], []
        for (code, account), row in holdings.items():
            try:
                close, price_source, amount = holding_value(row, prices.get(code))
            except ValueError as error:
                failures.append({"period": period, "code": code, "holder": row["HOLDER_NAME"], "reason": str(error)})
                continue
            matches = [r for r in ts if r["ts_code"] == code and portfolio_key(r["holder_name"]) == account]
            crosschecked = any(abs(r["hold_amount"] - row["HOLD_NUM"]) < 1 for r in matches)
            if not crosschecked:
                differences.append({"code": code, "holder": row["HOLDER_NAME"], "source_units": row["HOLD_NUM"],
                                    "tushare_units": [r["hold_amount"] for r in matches]})
            details.append({"code": code, "name": row["SECURITY_NAME_ABBR"], "holder": row["HOLDER_NAME"],
                            "account": account, "units": row["HOLD_NUM"], "close": close, "amount": amount,
                            "period": period, "announced": row["NOTICE_DATE"][:10].replace("-", ""),
                            "price_date": trade_date, "referencePrice": price_source != "Tushare daily",
                            "share_class": row["SHARES_TYPE"], "units_crosschecked": crosschecked,
                            "source": f'https://data.eastmoney.com/gdfx/stock/{code[:6]}.html'})
        ts_only = [{"code": r["ts_code"], "holder": r["holder_name"]} for r in ts
                   if (r["ts_code"], portfolio_key(r["holder_name"])) not in holdings]
        if not details:
            failures.append({"period": period, "reason": "no_verified_holdings"})
        snapshot = {"period": period, "amount": sum(r["amount"] for r in details),
                    "companyCount": len({r["code"] for r in details}), "holderCount": len(details),
                    "portfolioCount": len({r["account"] for r in details}),
                    "details": sorted(details, key=lambda r: -r["amount"]),
                    "coverage": {"primary_rows": len(primary), "crosschecked_rows": sum(r["units_crosschecked"] for r in details),
                                 "reference_price_rows": sum(r["referencePrice"] for r in details)},
                    "source_differences": differences, "tushare_only": ts_only, "excluded": excluded}
        snapshots[period] = snapshot
        save(CACHE / f"social-screened-{period}.json", snapshot)
        print(json.dumps({"period": period, "companies": snapshot["companyCount"], "amount": round(snapshot["amount"], 2),
                          "differences": len(differences), "ts_only": len(ts_only), "failures": len(failures)}), flush=True)
    save(CACHE / "social-export-failures.json", failures)
    if failures:
        raise ValueError(f"Unresolved social security audit: {len(failures)} entries")
    result = {"checkedAt": args.as_of, "start": args.start, "end": args.end, "unit": "亿元",
              "scope": "Named national social security investment portfolios, including explicit delegated portfolios; excludes council direct holdings, transferred state shares, basic pension portfolios and ETFs",
              "source": "Eastmoney RPT_DMSK_HOLDERS (top ten shareholders); Tushare top10_holders/daily crosschecks",
              "failures": [], "snapshots": list(snapshots.values())}
    save(OUTPUT, result)
    lines = ["# 社保基金投资组合A股持仓核查", "", f"核查截至 {args.as_of}；报告期 {args.start} 至 {args.end}。金额单位为亿元。", "",
             "仅识别全国社保基金具名投资组合，以及基金公司/证券公司明确标注的社保委托组合；不含理事会直持、转持/划转账户、基本养老保险基金、ETF及未进入公开榜单的持仓。不是社保基金全部资产，也不是净买入额。", "",
             "统一采用东方财富各期前十大股东表，按股票与社保组合编号去重；中文/阿拉伯数字编号统一。按公告日期选择截至核查日的最新披露，保留后来退市但当时已上市的A股。Tushare用于交叉核对，不把其早期混入的前十大流通股东条目另行并入。", "",
             "金额=披露A股股数×期末最后交易日未复权收盘价/1亿。缺少当日行情时采用数据源期末参考市值折算价，页面标＊。未知股份类别、价差或缺价阻止导出。明细保留逐条来源、公告日期、股数和参考价。", "",
             "| 报告期 | 金额 | 公司数 | 持仓条数 | 股数双源一致 | 期末参考价条数 |", "|---|---:|---:|---:|---:|---:|"]
    for period, row in snapshots.items():
        lines.append(f'| {period} | {row["amount"]:,.2f} | {row["companyCount"]} | {row["holderCount"]} | {row["coverage"]["crosschecked_rows"]} | {row["coverage"]["reference_price_rows"]} |')
    lines += ["", "来源间股数/覆盖差异保存在JSON的source_differences和tushare_only；主表采用明确前十大股东口径，不混加两类榜单。未匹配的社保类名称、划转账户等保存在excluded，避免把模糊名称误计入。金额变化含股价、持股数量和披露覆盖变化，退出前十不代表清仓。", "",
              "- [完整数据](../work/social_security_history.json)",
              "- [生成脚本](../work/fetch_social_security_history.py)",
              "- [Tushare前十大股东字段](https://tushare.pro/document/2?doc_id=61)",
              "- [Tushare日行情字段](https://tushare.pro/document/2?doc_id=27)", ""]
    (ROOT / "outputs" / "social-security-history-audit.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="20150630")
    parser.add_argument("--end", default="20260630")
    parser.add_argument("--as-of", default=datetime.now().strftime("%Y%m%d"))
    build(parser.parse_args())
