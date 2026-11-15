"""Migrate legacy weekly period labels using the exchange calendar."""
import json
import os
from pathlib import Path
from datetime import datetime
from fetch_large_money_sentiment_data import get_token, call_api
from weekly_dates import calendar_week_ends, align_rows

ROOT = Path(__file__).resolve().parents[1]


def main():
    first = ROOT / "work/large_money_sentiment_data.json"
    data = json.loads(first.read_text(encoding="utf-8"))
    ends = calendar_week_ends(get_token(), call_api, data["series"], datetime.now().strftime("%Y%m%d"))
    for name in ("large_money_sentiment_data", "large_money_index_data"):
        file = ROOT / "work" / (name + ".json")
        if not file.exists():
            continue
        value = json.loads(file.read_text(encoding="utf-8"))
        for key, rows in value.items():
            if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "date" in rows[0]:
                value[key] = align_rows(rows, ends)
        if isinstance(value.get("markets"), dict):
            value["markets"] = {key: align_rows(rows, ends) for key, rows in value["markets"].items()}
        meta = value.setdefault("meta", {})
        meta["weekDateSemantics"] = "ISO week period labelled by its last exchange trading day; weekly sums retain full period amounts, not Friday-only observations"
        if "series" in value:
            meta["start"] = value["series"][0]["date"]
            meta["end"] = value["series"][-1]["date"]
        temporary = file.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temporary, file)
        print(name, "weekly labels aligned", flush=True)


if __name__ == "__main__":
    main()
