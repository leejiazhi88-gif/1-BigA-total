"""Reusable raw date ranges, with an overlapping window for late corrections."""
import hashlib
import json
import os
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools" / "incremental-ranges"


def full_refresh():
    return os.environ.get("MARKET_FULL_REFRESH") == "1"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = Path(handle.name)
    temporary.replace(path)


def range_path(api, params, fields):
    scope = {k: v for k, v in params.items() if k != "end_date"}
    key = hashlib.sha256(json.dumps([api, scope, fields], sort_keys=True).encode()).hexdigest()
    return CACHE / (key + ".json")


def fetch_range(token, api, params, fields, fetch, date_field="trade_date", seeds=()):
    """Replace the last 28 calendar days; never append duplicate revisions.

    Cache identity includes the start bound, scope and fields. End-bound changes
    extend the same range. Older immutable years can be reused on another date.
    """
    start, end = params["start_date"], params["end_date"]
    scope = {k: v for k, v in params.items() if k != "end_date"}
    target = range_path(api, params, fields)
    prior = json.loads(target.read_text()) if target.exists() else None
    if prior is None and not full_refresh():
        for path in seeds:
            value = json.loads(path.read_text())
            candidate = value.get("params", {})
            if (value.get("api") == api and value.get("fields") == fields
                    and {k: v for k, v in candidate.items() if k != "end_date"} == scope
                    and candidate.get("end_date", "") <= end):
                if prior is None or candidate["end_date"] > prior["end"]:
                    prior = {"end": candidate["end_date"], "rows": value["rows"]}
    requested_end = os.environ.get("MARKET_END_DATE", datetime.now().strftime("%Y%m%d"))
    recent = (datetime.strptime(requested_end, "%Y%m%d") - timedelta(days=28)).strftime("%Y%m%d")
    if prior and not full_refresh() and end < recent and prior["end"] >= end:
        if not target.exists():
            write_json(target, prior)
        return [r for r in prior["rows"] if start <= r[date_field] <= end]
    since = start
    if prior and not full_refresh():
        anchor = min(prior["end"], end)
        since = max(start, (datetime.strptime(anchor, "%Y%m%d") - timedelta(days=28)).strftime("%Y%m%d"))
    rows = fetch(token, api, {**params, "start_date": since}, fields)
    if any(not r.get(date_field) or not since <= r[date_field] <= end for r in rows):
        raise ValueError(f"Unexpected source dates: {api}")
    # An empty recent response must not erase previously verified observations.
    if not rows and prior and any(since <= r[date_field] <= end for r in prior["rows"]):
        raise ValueError(f"Empty refresh over previously populated dates: {api}")
    older = [r for r in prior["rows"] if r[date_field] < since] if prior and not full_refresh() else []
    combined = older + rows
    write_json(target, {"end": end, "rows": combined})
    return combined
