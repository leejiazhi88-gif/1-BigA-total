"""Exact, source-backed non-trading holder event exclusions."""

import json
from pathlib import Path

FIELDS = ("ts_code", "ann_date", "holder_name", "in_de", "change_vol", "change_ratio", "avg_price")
ADJUSTMENTS = Path(__file__).with_name("holder_trade_adjustments.json")


def identity(row):
    return tuple(row.get(field) for field in FIELDS)


def correction_index():
    events = json.loads(ADJUSTMENTS.read_text())["events"]
    result = {identity(event["match"]): event for event in events}
    if len(result) != len(events):
        raise ValueError("Duplicate holder correction")
    return result
