import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


END_DATE = os.environ.get("MARKET_END_DATE") or datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")
datetime.strptime(END_DATE, "%Y%m%d")


def get_token():
    token = os.environ.get("TUSHARE_TOKEN")
    if token:
        return token
    config = Path.home() / ".codex" / "config.toml"
    text = config.read_text(encoding="utf-8") if config.exists() else ""
    match = re.search(r"https://api\.tushare\.pro/mcp/\?token=([^\"'&\s]+)", text)
    if not match:
        raise RuntimeError("Set TUSHARE_TOKEN before refreshing market data.")
    return match.group(1)


def call_api(token, api_name, params, fields):
    payload = json.dumps({"api_name": api_name, "token": token, "params": params, "fields": fields}).encode("utf-8")
    request = urllib.request.Request("https://api.tushare.pro", data=payload,
                                     headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60, context=ssl._create_unverified_context()) as response:
                result = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            if attempt == 2 or (error.code != 429 and error.code < 500):
                raise
            time.sleep(attempt + 1)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    if result.get("code") != 0:
        raise RuntimeError(f"{api_name}: {result.get('msg')}")
    data = result.get("data") or {}
    return [dict(zip(data.get("fields", []), row)) for row in data.get("items", [])]


def call_api_pages(token, api_name, params, fields, page_size):
    rows, offset, previous = [], 0, None
    while True:
        page = call_api(token, api_name, {**params, "limit": page_size, "offset": offset}, fields)
        signature = json.dumps(page, sort_keys=True)
        if page and signature == previous:
            raise RuntimeError(f"{api_name}: repeated page; refusing a truncated refresh")
        previous = signature
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += len(page)
