"""Audit period-matched A-share capital and ETF net assets for ownership ratios."""

import argparse
import hashlib
import json
import math
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

from fetch_national_team_stock_history import ROOT, read, save, web_json

CACHE = ROOT / ".tools" / "national-team-stock-history"
OUTPUT = ROOT / "work" / "holding_denominators.json"


def stock_positions():
    national = read(ROOT / "work" / "national_team_stock_history.json")
    social = read(ROOT / "work" / "social_security_history.json")
    result = {}
    for period, row in national["stocks"].items():
        result[period] = [{"code": d["ts_code"], "close": d["close"]} for d in row["details"]]
    for row in social["snapshots"]:
        result.setdefault(row["period"], []).extend({"code": d["code"], "close": d["close"]} for d in row["details"])
    return result


def fetch_capital(code):
    target = CACHE / f"ratio-capital-{code}.json"
    if target.exists():
        return read(target)
    rows, total, signatures, page = [], None, set(), 1
    while True:
        params = {"reportName": "RPT_F10_EH_EQUITY", "columns": "ALL", "pageSize": 50, "pageNumber": page,
                  "sortColumns": "END_DATE", "sortTypes": "-1", "filter": f'(SECUCODE="{code}")(END_DATE<=\'2026-06-30\')'}
        url = "https://datacenter-web.eastmoney.com/api/data/v1/get?" + urllib.parse.urlencode(params)
        response = web_json(url, f"ratio-capital-page-{code}-{page}.json")
        result = response.get("result")
        if not result:
            raise ValueError("No share capital history: " + code)
        if total is not None and total != result["count"]:
            raise ValueError("Share capital source changed: " + code)
        total = result["count"]
        batch = result.get("data") or []
        signature = hashlib.sha256(json.dumps(batch, sort_keys=True).encode()).hexdigest()
        if signature in signatures:
            raise ValueError("Repeated share capital page: " + code)
        signatures.add(signature)
        rows.extend(batch)
        if page >= result["pages"]:
            break
        page += 1
    if len(rows) != total or not rows:
        raise ValueError("Incomplete share capital history: " + code)
    save(target, rows)
    return rows


def capital_at(rows, period, as_of="20261027", adjustment=None):
    eligible = [r for r in rows if r["END_DATE"][:10].replace("-", "") <= period
                and (r.get("NOTICE_DATE") or r["END_DATE"])[:10].replace("-", "") <= as_of]
    if not eligible:
        raise ValueError("No capital record on or before report date")
    date = max(r["END_DATE"] for r in eligible)
    current = [r for r in eligible if r["END_DATE"] == date]
    values = {r.get("TOTAL_A_SHARES") for r in current}
    if len(values) != 1:
        raise ValueError("Conflicting A-share capital records")
    value = next(iter(values))
    row = current[0]
    components = (row.get("LISTED_A_SHARES") or 0) + (row.get("LIMITED_A_SHARES") or 0)
    corrected = False
    if adjustment and value != adjustment["aShares"]:
        if (row.get("TOTAL_SHARES") == adjustment["totalShares"] and
                row.get("NON_FREE_SHARES") == adjustment["unlistedForeignShares"] and
                components == adjustment["aShares"] and
                components + adjustment["unlistedForeignShares"] == adjustment["totalShares"]):
            value, corrected = components, True
    if not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
        raise ValueError("Missing A-share capital")
    if components and abs(value - components) > 1:
        raise ValueError("A-share capital components disagree")
    if row.get("TOTAL_SHARES") and value > row["TOTAL_SHARES"] + 1:
        raise ValueError("A shares exceed total capital")
    return {"shares": value, "effective": date[:10], "announced": (row.get("NOTICE_DATE") or "")[:10],
            "source": "https://data.eastmoney.com/stockdata/" + row["SECURITY_CODE"] + ".html",
            "report": row.get("INFO_CODE"), "totalSharesAllClasses": row.get("TOTAL_SHARES"),
            **({"adjustmentSource": adjustment["source"], "originalSourceAShares": row["TOTAL_A_SHARES"]} if corrected else {})}


def collect():
    codes = sorted({r["code"] for rows in stock_positions().values() for r in rows})
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(fetch_capital, code): code for code in codes}
        for number, job in enumerate(as_completed(jobs), 1):
            code = jobs[job]
            try:
                job.result()
            except Exception as error:
                failures.append({"code": code, "error": str(error)})
            if number % 100 == 0 or number == len(codes):
                print(json.dumps({"capitalCodes": number, "total": len(codes), "failures": len(failures)}), flush=True)
    save(CACHE / "ratio-capital-fetch-failures.json", failures)
    if failures:
        raise ValueError(f"Capital history download failures: {len(failures)}")


def export_stocks():
    stocks, failures = {}, []
    adjustments = read(ROOT / "work" / "holding_capital_adjustments.json")
    for period, positions in stock_positions().items():
        details = {}
        for code in sorted({r["code"] for r in positions}):
            try:
                details[code] = capital_at(read(CACHE / f"ratio-capital-{code}.json"), period, adjustment=adjustments.get(code))
            except (ValueError, FileNotFoundError) as error:
                failures.append({"period": period, "code": code, "error": str(error)})
        stocks[period] = details
    save(CACHE / "ratio-capital-export.json", {"stocks": stocks, "failures": failures})
    print(json.dumps({"periods": len(stocks), "observations": sum(map(len, stocks.values())), "failures": len(failures)}))
    return stocks, failures


def fund_totals(text, nav, holders):
    compact = re.sub(r"\s", "", text)
    number = r"([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)"
    unit_pattern = r"(?:报告期末基金份额总额|本报告期期末基金份额总额)(?:[（(]份[）)])?[:：]?" + number
    matches = list(re.finditer(unit_pattern, compact))
    units = {float(m[1].replace(",", "")) for m in matches}
    if len(units) != 1 or next(iter(units)) <= 0:
        raise ValueError("Missing or conflicting ETF total units")
    units = next(iter(units))
    money = r"([0-9,]+\.[0-9]{2})"
    asset = re.search(r"(?:期末基金资产净值|期末基金净资产|期末净资产)(?:[（(]元[）)])?[:：]?" + money, compact)
    if not asset:
        asset = re.search(r"(?:净资产合计|所有者权益合计)" + money, compact)
    if not asset:
        raise ValueError("Missing ETF net assets")
    assets = float(asset[1].replace(",", ""))
    if abs(assets / units - nav) > 0.00051:
        raise ValueError("ETF units/NAV/net assets do not reconcile")
    if sum(h["units"] for h in holders) > units:
        raise ValueError("ETF identified units exceed total units")
    off_exchange = re.search(r"期末基金总份额包含场外份额" + number, compact)
    unlisted = float(off_exchange[1].replace(",", "")) if off_exchange else 0
    listed_units = units - unlisted
    if listed_units <= 0:
        raise ValueError("Invalid ETF listed units")
    for holder in holders:
        disclosed = holder.get("ratio_pct")
        if disclosed is not None and abs(holder["units"] / listed_units * 100 - disclosed) > 0.011:
            raise ValueError("ETF ownership disagrees with disclosed ratio")
    return {"units": units, "nav": nav, "amount": units * nav / 1e8, "reportedNetAssets": assets,
            "listedUnits": listed_units, "unlistedUnits": unlisted,
            "unlistedEvidence": off_exchange[0] if off_exchange else None,
            "unitsEvidence": matches[0][0], "netAssetsEvidence": asset[0]}


def export_all():
    stocks, failures = export_stocks()
    funds = {}
    history = read(ROOT / "work" / "national_team_etf_history.json")
    for report in history["reports"]:
        if report["status"] != "identified":
            continue
        key = report["code"] + ":" + report["period"]
        try:
            document = read(ROOT / ".tools" / "national-team-history" / (report["report_id"] + ".json"))
            totals = fund_totals(document["data"]["notice_content"], report["nav"], report["holders"])
            funds[key] = {**totals, "code": report["code"], "period": report["period"], "source": report["source"],
                          "report_id": report["report_id"], "announced": report["announced"],
                          "identifiedUnits": report["units"]}
        except (ValueError, FileNotFoundError) as error:
            failures.append({"fund": key, "error": str(error)})
    save(CACHE / "ratio-export-failures.json", failures)
    if failures:
        raise ValueError(f"Unresolved denominator audit: {len(failures)} records")
    save(OUTPUT, {"checkedAt": "2026-10-27", "scope": "Period-specific held A-share companies and identified ETF funds; each security counted once",
                  "stockSource": "Eastmoney RPT_F10_EH_EQUITY TOTAL_A_SHARES", "fundSource": "Original ETF periodic reports",
                  "failures": [], "stocks": stocks, "funds": funds})
    print(json.dumps({"output": str(OUTPUT), "stockPeriods": len(stocks), "fundReports": len(funds)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("collect", "stocks", "export"), default="collect")
    args = parser.parse_args()
    {"collect": collect, "stocks": export_stocks, "export": export_all}[args.stage]()
