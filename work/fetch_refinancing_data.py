"""Refresh implemented additional/rights issues, using project 6's source logic."""
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from refinancing_metrics import normalize_issuances, aggregate_refinancing
from refresh_cache import write_json, full_refresh
from tushare_client import END_DATE, call_api_pages, get_token

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "refinancing_data.json"
SOURCE = ROOT / "work" / "refinancing_issuance_records.json"
CACHE = ROOT / ".tools" / "refinancing" / "raw.json"
ENDPOINT = "https://datacenter-web.eastmoney.com/api/data/v1/get"
REPORTS = {
    "additional": ("RPT_SEO_DETAIL", "ISSUE_DATE", "SECUCODE,SECURITY_NAME_ABBR,FINANCE_CODE,ISSUE_DATE,ISSUE_LISTING_DATE,ISSUE_NUM,ISSUE_PRICE,TOTAL_RAISE_FUNDS,ISSUE_WAY,SEO_TYPE"),
    "rights": ("RPT_IPO_ALLOTMENT", "PAY_END_DATE", "SECUCODE,SECURITY_NAME_ABBR,FINANCE_CODE,PAY_END_DATE,LISTING_DATE,ISSUE_NUM,ISSUE_PRICE,TOTAL_RAISE_FUNDS"),
}


def request_page(report, date_field, columns, start, page):
    params = dict(reportName=report, columns=columns, sortColumns=date_field + ",FINANCE_CODE", sortTypes="-1,-1",
                  pageSize=500, pageNumber=page, source="WEB", client="WEB", filter=f"({date_field}>='{start}')")
    request = urllib.request.Request(ENDPOINT + "?" + urlencode(params), headers={"User-Agent": "Mozilla/5.0"})
    cert = os.environ.get("SSL_CERT_FILE") or ("/etc/ssl/cert.pem" if Path("/etc/ssl/cert.pem").exists() else None)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30, context=ssl.create_default_context(cafile=cert)) as response:
                payload = json.load(response)
            if not payload.get("success") or not isinstance(payload.get("result"), dict):
                raise ValueError("Invalid issuance response")
            return payload["result"]
        except urllib.error.HTTPError as error:
            if attempt == 2 or (error.code != 429 and error.code < 500):
                raise
            time.sleep(attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def fetch_complete(report, date_field, columns, start, request=request_page):
    first = request(report, date_field, columns, start, 1)
    pages, count = first["pages"], first["count"]
    if not 1 <= pages <= 100 or not count:
        raise ValueError(f"Empty or unexpectedly large issuance response: {report}")
    rows = list(first["data"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        for page in pool.map(lambda number: request(report, date_field, columns, start, number), range(2, pages + 1)):
            if page["pages"] != pages or page["count"] != count:
                raise ValueError(f"Issuance source changed during pagination: {report}")
            rows.extend(page["data"])
    identities = [str(row["FINANCE_CODE"]) for row in rows]
    if len(rows) != count or len(set(identities)) != count:
        raise ValueError(f"Truncated or duplicate issuance pages: {report}")
    if pages > 1:
        check = request(report, date_field, columns, start, 1)
        if check["count"] != count or check["data"] != first["data"]:
            raise ValueError(f"Issuance source changed during pagination: {report}")
    return rows


def main():
    end = datetime.strptime(END_DATE, "%Y%m%d")
    previous = json.loads(CACHE.read_text()) if CACHE.exists() and not full_refresh() else None
    if previous and not previous.get("completeFrom2008"):
        previous = None
    # Anchor overlap to the earlier cutoff so a long gap between runs loses no records.
    anchor = min(end, datetime.fromisoformat(previous["requestedEnd"])) if previous else end
    since = (anchor - timedelta(days=180)).strftime("%Y-%m-%d")
    raw = {}
    for kind, (report, date_field, columns) in REPORTS.items():
        start = max("2008-01-01", since) if previous and kind == "additional" else "2008-01-01"
        fresh = fetch_complete(report, date_field, columns, start)
        older = [row for row in previous[kind] if (row.get(date_field) or "")[:10] < start] if previous else []
        raw[kind] = older + fresh
        print(f"{kind}: {len(raw[kind])} source records", flush=True)
    token = get_token()
    listing_dates = {}
    for status in ("L", "D", "P"):
        rows = call_api_pages(token, "stock_basic", {"list_status": status}, "ts_code,list_date", 6000)
        if status != "P" and not rows:
            raise ValueError("Incomplete initial-listing metadata")
        listing_dates.update({row["ts_code"]: row["list_date"] for row in rows if row.get("list_date")})
    records, excluded = normalize_issuances(raw["additional"], raw["rights"], listing_dates, end.strftime("%Y-%m-%d"))
    if not records:
        raise ValueError("Empty completed-issuance dataset")
    data = aggregate_refinancing(records, end.strftime("%Y-%m"))
    meta = {
        "updated": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"), "requestedEnd": END_DATE,
        "provider": "东方财富数据中心", "source": "https://data.eastmoney.com/other/qbzf.html",
        "rightsSource": "https://data.eastmoney.com/xg/pg/", "unit": "亿元", "frequency": "monthly",
        "definition": "沪深A股已实施增发与配股发行金额；含非现金资产认购及换股合并，不等于现金到账；不含IPO、可转债及北交所。",
        "dateDefinition": "增发按发行日、配股按缴款截止日归月；仅展示已结束月份，横轴标记月末。",
        "missing": "已发现记录但缺发行金额的市场整月留空；已完整查询且无发行记录的月份记零。",
        "currentMonthExcluded": True, "start": data["series"][0]["date"], "end": data["series"][-1]["date"],
        "sourceRecords": len(records), "excludedRecords": len(excluded),
    }
    write_json(SOURCE, {"meta": meta, "records": records, "excluded": excluded})
    write_json(OUTPUT, {"meta": meta, **data})
    write_json(CACHE, {**raw, "completeFrom2008": True, "requestedEnd": end.strftime("%Y-%m-%d")})
    print(json.dumps({"records": len(records), "excluded": len(excluded), "latest": data["series"][-1]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
