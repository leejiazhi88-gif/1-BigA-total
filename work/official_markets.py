"""Exchange splits for issuance and disclosed shareholder transactions."""
import json
import math
from collections import defaultdict
from datetime import datetime

from large_money_markets import fetch_cached, sh_sz_a_share, week_key, iso
from tushare_client import END_DATE, get_token


def aggregate(rows, metric):
    weeks = defaultdict(lambda: {"dates": [], "sh": 0., "sz": 0.})
    seen = set()
    for row in rows:
        if not sh_sz_a_share(row.get("ts_code")):
            continue
        if metric == "ipoFunds":
            date = row.get("ipo_date") or row.get("issue_date")
            identity = (row["ts_code"], date)
            amount = row.get("funds")
        else:
            date = row.get("ann_date")
            identity = tuple(row.get(k) for k in ("ts_code", "ann_date", "holder_name", "in_de", "change_vol", "change_ratio", "avg_price"))
            if row.get("avg_price") is None or row.get("change_vol") is None or row.get("in_de") not in ("IN", "DE"):
                continue
            amount = float(row["change_vol"]) * float(row["avg_price"]) / 1e8 * (1 if row["in_de"] == "DE" else -1)
        if not date or date > END_DATE or amount is None or identity in seen:
            continue
        if not math.isfinite(float(amount)):
            raise ValueError(f"Invalid {metric} amount on {date}")
        seen.add(identity)
        item = weeks[week_key(date)]
        item["dates"].append(date)
        item[row["ts_code"][-2:].lower()] += float(amount)
    return weeks


def attach_markets(data, token):
    ipo, holders = [], []
    for year in range(2000, int(END_DATE[:4]) + 1):
        params = {"start_date": f"{year}0101", "end_date": min(f"{year}1231", END_DATE)}
        ipo.extend(fetch_cached(token, "new_share", params, "ts_code,ipo_date,issue_date,funds"))
        holders.extend(fetch_cached(token, "stk_holdertrade", params,
                                    "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price"))
        print(f"official market split {year}", flush=True)
    groups = {"ipoFunds": aggregate(ipo, "ipoFunds"), "netReduceAmount": aggregate(holders, "netReduceAmount")}
    combined = {r["date"]: {k: v for k, v in r.items() if k not in groups} for r in data["series"]}
    markets = {"sh": {}, "sz": {}}
    for metric, weeks in groups.items():
        if not weeks:
            raise ValueError(f"Missing {metric} records")
        for item in weeks.values():
            date = iso(max(item["dates"]))
            combined.setdefault(date, {"date": date})[metric] = round(item["sh"] + item["sz"], 4)
            for market in markets:
                markets[market].setdefault(date, {"date": date})[metric] = round(item[market], 4)
    data["series"] = [combined[d] for d in sorted(combined) if len(combined[d]) > 1]
    data["markets"] = {market: [rows[d] for d in sorted(rows)] for market, rows in markets.items()}
    data["meta"]["marketSplit"] = {"checkedAt": datetime.now().strftime("%Y-%m-%d"), "requestedEnd": END_DATE,
                                   "scope": "Shanghai/Shenzhen A shares; known-price holder disclosures only; other metrics national"}
    data["meta"]["start"] = data["series"][0]["date"]
    return data


if __name__ == "__main__":
    from fetch_official_sentiment_data import OUTPUT
    data = attach_markets(json.loads(OUTPUT.read_text()), get_token())
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
