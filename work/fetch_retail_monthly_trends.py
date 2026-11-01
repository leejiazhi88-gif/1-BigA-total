import json
import re
import time
import urllib.parse
import urllib.request
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pymupdf

from tushare_client import call_api, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "retail_monthly_trends.json"
SSE_SOURCE = "https://star.sse.com.cn/aboutus/publication/monthly/investor/"
SSE_QUERY = "https://query.sse.com.cn/commonQuery.do"
SSE_YEARBOOKS = "https://www.sse.com.cn/aboutus/publication/yearly/"


def yearbook_accounts(year, url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                document = pymupdf.open(stream=response.read(), filetype="pdf")
            break
        except OSError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    number = r"\d+(?:\.\d+)?"
    pattern = re.compile(rf"{year}\.\s*(\d{{1,2}})\s+({number})\s+({number})\s+({number})\s+({number})")
    for page in document:
        text = unicodedata.normalize("NFKC", page.get_text()).replace("􀆰", ".")
        text = re.sub(r"(?<=\d)\s*\.\s*(?=\d)", ".", text)
        matches = pattern.findall(text)
        if len(matches) != 12:
            continue
        rows = [{"month": f"{year}-{int(month):02d}", "accountsWan": float(a_share)}
                for month, _, a_share, _, _ in matches]
        if [row["month"] for row in rows] != [f"{year}-{month:02d}" for month in range(1, 13)]:
            continue
        values = [row["accountsWan"] for row in rows]
        if all(left <= right for left, right in zip(values, values[1:])):
            for index in range(11, 0, -1):
                rows[index]["accountsWan"] = round(values[index] - values[index - 1], 2)
        return rows
    raise ValueError(f"No complete monthly A-share accounts table in SSE yearbook {year + 1}")


def historical_accounts(existing):
    request = urllib.request.Request(SSE_YEARBOOKS, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        listing = response.read().decode("utf-8", errors="replace")
    links = {}
    for path, title in re.findall(r'href="([^"]+\.pdf)"[^>]+title="([^"]+)"', listing):
        match = re.search(r"(20\d{2})", title)
        if match:
            links[int(match.group(1)) - 1] = urllib.parse.urljoin(SSE_YEARBOOKS, path)
    accounts = {row["month"]: row for row in existing if row["month"] >= "2005-01"}
    for year in range(2007, 2021):
        if all(f"{year}-{month:02d}" in accounts for month in range(1, 13)):
            continue
        if year not in links:
            continue
        try:
            for row in yearbook_accounts(year, links[year]):
                accounts[row["month"]] = row
        except (OSError, ValueError) as error:
            print(f"SSE yearbook {year + 1}: {error}")
    return list(accounts.values())


def sse_year(year, current_year, current_month):
    months = range(current_month, 0, -1) if year == current_year else (12,)
    for month in months:
        params = urllib.parse.urlencode({
            "sqlId": "COMMON_SSE_TZZ_M_ALL_ACCT_C",
            "isPagination": "false",
            "MDATE": f"{year}{month:02d}",
            "jsonCallBack": "monthlyCallback",
        })
        request = urllib.request.Request(
            f"{SSE_QUERY}?{params}",
            headers={"Referer": SSE_SOURCE, "User-Agent": "Mozilla/5.0"},
        )
        for attempt in range(3):
            try:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler() if attempt < 2
                    else urllib.request.ProxyHandler({}),
                )
                with opener.open(request, timeout=20) as response:
                    body = response.read().decode("utf-8")
                break
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        match = re.fullmatch(r"monthlyCallback\((.*)\)\s*", body, re.S)
        if not match:
            raise ValueError("Unexpected SSE response format")
        rows = json.loads(match.group(1)).get("result") or []
        if rows:
            return [
                {"month": row["TERM"].replace(".", "-"), "accountsWan": float(row["A_ACCT"])}
                for row in rows if re.fullmatch(r"\d{4}\.\d{2}", row.get("TERM", ""))
                and float(row.get("A_ACCT") or 0) > 0
            ]
    return []


def fund_months(token, current_month):
    funds = {}
    for market in ("E", "O"):
        for status in ("L", "D"):
            offset = 0
            while True:
                rows = call_api(
                    token, "fund_basic", {"market": market, "status": status,
                                          "limit": 5000, "offset": offset},
                    "ts_code,found_date,issue_amount,fund_type,p_value",
                )
                for row in rows:
                    funds[row["ts_code"]] = row
                offset += len(rows)
                if len(rows) < 5000:
                    break
    months = defaultdict(lambda: {"funds": 0, "reported": 0, "sharesYi": 0.0,
                                  "equitySharesYi": 0.0})
    for row in funds.values():
        founded = row.get("found_date") or ""
        if not re.fullmatch(r"\d{8}", founded):
            continue
        month = f"{founded[:4]}-{founded[4:6]}"
        if month < "2005-01" or month > current_month:
            continue
        item = months[month]
        item["funds"] += 1
        amount = row.get("issue_amount")
        if amount is None or float(amount) < 0:
            continue
        item["reported"] += 1
        item["sharesYi"] += float(amount)
        if row.get("fund_type") in ("股票型", "混合型"):
            item["equitySharesYi"] += float(amount)
    return [
        {"month": month, "sharesYi": round(item["sharesYi"], 2) if item["reported"] else None,
         "equitySharesYi": round(item["equitySharesYi"], 2) if item["reported"] else None,
         "funds": item["funds"], "reported": item["reported"],
         "coverage": round(item["reported"] / item["funds"] * 100, 1)}
        for month, item in sorted(months.items())
    ]


def main():
    today = datetime.now(ZoneInfo("Asia/Shanghai"))
    completed_month_end = today.replace(day=1) - timedelta(days=1)
    current_month = completed_month_end.strftime("%Y-%m")
    existing = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    accounts = historical_accounts(existing.get("accounts", []))
    for year in range(2021, completed_month_end.year + 1):
        accounts.extend(sse_year(year, completed_month_end.year, completed_month_end.month))
    if not accounts:
        raise RuntimeError("SSE account data is unavailable")
    accounts = sorted({row["month"]: row for row in accounts}.values(), key=lambda row: row["month"])
    funds = fund_months(get_token(), current_month)
    if not funds:
        raise RuntimeError("Fund issuance data is unavailable")
    payload = {
        "meta": {
            "accountsSource": SSE_SOURCE,
            "accountsHistoricalSource": SSE_YEARBOOKS,
            "fundsSource": "https://tushare.pro/document/1?doc_id=19",
            "accountsScope": "SSE monthly A-share new accounts, not unique national investors",
            "fundsScope": "Sum of reported fund-code initial issuance shares; unit 100 million shares",
            "fundCoverageThreshold": 90,
        },
        "accounts": accounts,
        "funds": funds,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "accounts": [len(accounts), accounts[0]["month"], accounts[-1]["month"]],
        "funds": [len(funds), funds[0]["month"], funds[-1]["month"]],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
