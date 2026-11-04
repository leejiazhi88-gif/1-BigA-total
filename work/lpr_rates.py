"""Published LPR quotes, with official records supplementing delayed API data."""
import json
import math
import os
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from refresh_cache import fetch_range
from tushare_client import END_DATE, call_api

OFFICIAL_URL = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis"


def normalize_quotes(rows, end):
    quotes = {}
    for row in rows:
        date = row["date"]
        datetime.strptime(date, "%Y%m%d")
        if not "20131025" <= date <= end:
            raise ValueError(f"LPR date outside requested history: {date}")
        item = {"date": f"{date[:4]}-{date[4:6]}-{date[6:]}", "source": row["source"]}
        for source, field in (("1y", "lpr1y"), ("5y", "lpr5y")):
            value = row.get(source)
            number = None if value in (None, "", "---", "--") else float(value)
            if number is not None and (not math.isfinite(number) or number < 0):
                raise ValueError(f"Invalid {field} on {date}")
            item[field] = number
        if item["lpr1y"] is None:
            raise ValueError(f"Missing 1-year LPR on {date}")
        if date < "20190820" and item["lpr5y"] is not None:
            raise ValueError(f"5-year LPR predates its introduction: {date}")
        if date >= "20190820" and item["lpr5y"] is None:
            raise ValueError(f"Missing 5-year LPR on {date}")
        if date in quotes and any(quotes[date][key] != item[key] for key in ("lpr1y", "lpr5y")):
            raise ValueError(f"Conflicting LPR quotes on {date}")
        quotes[date] = item
    return [quotes[date] for date in sorted(quotes)]


def official_quotes(start, end):
    query = urllib.parse.urlencode({"lang": "CN", "strStartDate": start, "strEndDate": end})
    request = urllib.request.Request(OFFICIAL_URL + "?" + query, data=b"", method="POST")
    cert = os.environ.get("SSL_CERT_FILE")
    if not cert and Path("/etc/ssl/cert.pem").exists():
        cert = "/etc/ssl/cert.pem"
    with urllib.request.urlopen(request, context=ssl.create_default_context(cafile=cert), timeout=30) as response:
        payload = json.load(response)
    if str(payload.get("head", {}).get("rep_code")) != "200":
        raise ValueError("Official LPR query failed")
    rows = []
    for row in payload["records"]:
        date = row["showDateCN"]
        if not start <= date <= end:
            raise ValueError(f"Official LPR date outside query: {date}")
        rows.append({"date": date.replace("-", ""), "1y": row.get("1Y"),
                     "5y": row.get("5Y"), "source": "ChinaMoney"})
    return rows


def fetch_lpr_history(token, end=END_DATE, previous=None):
    rows = []
    for year in range(2013, int(end[:4]) + 1):
        params = {"start_date": max(f"{year}0101", "20131025"), "end_date": min(f"{year}1231", end)}
        rows.extend({**row, "source": "Tushare"} for row in fetch_range(
            token, "shibor_lpr", params, "date,1y,5y", call_api, "date"))
    series = normalize_quotes(rows, end)
    if not series:
        raise ValueError("No LPR history returned")
    # Check the official feed once a monthly quote may be due; holidays can delay it.
    cutoff = datetime.strptime(end, "%Y%m%d")
    expected_month = cutoff if cutoff.day >= 20 else cutoff.replace(day=1) - timedelta(days=1)
    if series[-1]["date"][:7] < expected_month.strftime("%Y-%m"):
        rows.extend(official_quotes(series[-1]["date"], cutoff.strftime("%Y-%m-%d")))
        series = normalize_quotes(rows, end)
    known_dates = {row["date"] for row in (previous or {}).get("series", [])
                   if row["date"] <= cutoff.strftime("%Y-%m-%d")}
    if not known_dates.issubset({row["date"] for row in series}):
        raise ValueError("LPR refresh lost previously verified quotes; retaining published cache")
    return {"meta": {
        "requestedEnd": end,
        "source": "Tushare shibor_lpr; delayed months supplemented by ChinaMoney official quotes",
        "sourceUrl": "https://www.chinamoney.com.cn/chinese/bklpr/",
        "unit": "%", "end": series[-1]["date"],
        "method": "Actual quote dates; 1Y before 2019-08-20 uses the old mechanism; no pre-launch 5Y values or extrapolation beyond the last quote"
    }, "series": series}
