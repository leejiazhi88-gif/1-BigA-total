"""Seven-day reverse repo operation rates from PBOC's original announcements."""
import hashlib
import json
import math
import re
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from tushare_client import END_DATE

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/"
START = "2006-06-05"
CACHE = ROOT / ".tools" / "reverse-repo"


class AnnouncementIndex(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.rows = []
        self.pending = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("istitle") == "true":
            self.pending = urljoin(BASE, attrs["href"])

    def handle_data(self, text):
        date = text.strip()
        if self.pending and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            self.rows.append({"date": date, "sourceUrl": self.pending})
            self.pending = None


class OperationTables(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.depth = 0
        self.text = []
        self.tables = []
        self.stack = []
        self.table = None
        self.row = None
        self.cell = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            if dict(attrs).get("id") == "zoom" or self.depth:
                self.depth += 1
        if not self.depth:
            return
        if tag == "table":
            if self.table is not None:
                self.stack.append((self.table, self.row, self.cell))
            self.table = {"context": "".join(self.text)[-300:], "rows": []}
            self.row = self.cell = None
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_data(self, text):
        if self.depth:
            self.text.append(text)
            if self.cell is not None:
                self.cell.append(text)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(re.sub(r"\s+", "", "".join(self.cell)))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table["rows"].append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table, self.row, self.cell = self.stack.pop() if self.stack else (None, None, None)
        elif tag == "div" and self.depth:
            self.depth -= 1


def parse_operation(html, date, url):
    parser = OperationTables(html)
    if not parser.text:
        raise ValueError(f"Missing announcement body: {url}")
    rates = set()
    for table in parser.tables:
        context = table["context"]
        # Some announcements contain both directions or central-bank bill tables.
        reverse_pos = context.rfind("逆回购")
        if reverse_pos < 0 or reverse_pos < max(context.rfind("正回购"), context.rfind("央行票据")) \
                or context[max(0, reverse_pos - 3):reverse_pos] == "买断式":
            continue
        headers = next((r for r in table["rows"] if any("利率" in c for c in r)), [])
        rate_col = next((i for i, c in enumerate(headers) if "利率" in c), None)
        tenor_col = next((i for i, c in enumerate(headers) if "期限" in c), None)
        for row in table["rows"]:
            if tenor_col is None or tenor_col >= len(row) or row[tenor_col] not in ("7天", "7天期"):
                continue
            if rate_col is None or rate_col >= len(row):
                raise ValueError(f"Missing seven-day rate column: {url}")
            match = re.fullmatch(r"(\d+(?:\.\d+)?)%?", row[rate_col].replace("％", "%"))
            if not match:
                raise ValueError(f"Invalid seven-day operation rate: {url}")
            rate = float(match[1])
            if not math.isfinite(rate) or not 0 < rate < 20:
                raise ValueError(f"Invalid operation rate: {url}")
            rates.add(rate)
    if len(rates) > 1:
        raise ValueError(f"Conflicting seven-day rates: {url}")
    if not rates:
        text = re.sub(r"\s+", "", "".join(parser.text))
        if re.search(r"7天(?:期)?逆回购", text) and not re.search(r"7天(?:期)?逆回购操作量为零", text):
            raise ValueError(f"Unparsed seven-day reverse repo announcement: {url}")
        return None
    return {"date": date, "reverseRepo7d": rates.pop(), "sourceUrl": url}


def read_url(url, cached=False):
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + ".html")
    if cached and path.exists():
        return path.read_text(encoding="utf-8")
    cert = "/etc/ssl/cert.pem" if Path("/etc/ssl/cert.pem").exists() else None
    context = ssl.create_default_context(cafile=cert)
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "A-Total policy rate research"})
            with urllib.request.urlopen(request, timeout=25, context=context) as response:
                html = response.read().decode("utf-8")
            if cached:
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(html, encoding="utf-8")
            return html
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def fetch_reverse_repo_history(end=END_DATE, previous=None):
    cutoff = datetime.strptime(end, "%Y%m%d").strftime("%Y-%m-%d")
    previous = previous or {}
    previous_rows = [r for r in previous.get("series", []) if r["date"] <= cutoff]
    start = START
    if previous_rows:
        start = max(START, (datetime.strptime(previous_rows[-1]["date"], "%Y-%m-%d")
                            - timedelta(days=28)).strftime("%Y-%m-%d"))
    announcements = {}
    for page in range(1, 251):
        url = BASE + ("index.html" if page == 1 else f"17081-{page}.html")
        rows = AnnouncementIndex(read_url(url)).rows
        if not rows:
            raise ValueError(f"Empty PBOC announcement listing: {url}")
        for row in rows:
            if start <= row["date"] <= cutoff:
                announcements[row["sourceUrl"]] = row
        if min(r["date"] for r in rows) < start:
            break
    else:
        raise ValueError("PBOC archive pagination did not reach the requested start")
    print(f"PBOC: checking {len(announcements)} announcements ({start} to {cutoff})", flush=True)

    def fetch(row):
        # Recheck the recent window, cache immutable older source pages for full rebuilds.
        recent = row["date"] >= (datetime.strptime(cutoff, "%Y-%m-%d") - timedelta(days=28)).strftime("%Y-%m-%d")
        return parse_operation(read_url(row["sourceUrl"], cached=not recent), row["date"], row["sourceUrl"])

    merged = {r["date"]: r for r in previous_rows if r["date"] < start}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, row in enumerate(pool.map(fetch, announcements.values()), 1):
            if row:
                known = merged.get(row["date"])
                if known and known["reverseRepo7d"] != row["reverseRepo7d"]:
                    raise ValueError(f"Conflicting PBOC announcements on {row['date']}")
                merged[row["date"]] = row
            if i % 250 == 0:
                print(f"PBOC: verified {i}/{len(announcements)} announcements", flush=True)
    if not merged or not {r["date"] for r in previous_rows}.issubset(merged):
        raise ValueError("Reverse repo refresh lost published observations")
    series = [merged[d] for d in sorted(merged)]
    return {"meta": {"source": "PBOC open market operation announcements", "sourceUrl": BASE + "index.html",
                     "requestedEnd": end, "checkedThrough": cutoff, "unit": "% per annum",
                     "start": series[0]["date"], "end": series[-1]["date"],
                     "method": "Actual 7-day reverse repo operation dates; excludes overnight, 14-day, outright reverse repo and market repo quotes"},
            "series": series}


if __name__ == "__main__":
    output = ROOT / "work" / "official_sentiment_data.json"
    data = json.loads(output.read_text(encoding="utf-8"))
    data["reverseRepo"] = fetch_reverse_repo_history(previous=data.get("reverseRepo"))
    for row in data["series"]:
        row.pop("policyRate", None)
    data["meta"]["sources"]["policyRate"] = "PBOC 7-day reverse repo; Tushare/ChinaMoney LPR"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(data["reverseRepo"]["meta"], ensure_ascii=False), flush=True)
