import calendar
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from tushare_client import END_DATE, call_api, call_api_pages, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "large_money_sentiment_data.json"
START_YEAR = 2018
END_YEAR = int(END_DATE[:4])



def month_ranges():
    for year in range(START_YEAR, END_YEAR + 1):
        for month in range(1, 13):
            if year == END_YEAR and month > int(END_DATE[4:6]):
                return
            last = calendar.monthrange(year, month)[1]
            end = f"{year}{month:02d}{last:02d}"
            if year == END_YEAR and month == int(END_DATE[4:6]):
                end = END_DATE
            yield f"{year}{month:02d}01", end


def week_key(date):
    dt = datetime.strptime(date, "%Y%m%d")
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def week_end_date(dates):
    return max(dates)


def main():
    token = get_token()
    north = call_api(
        token,
        "moneyflow_hsgt",
        {"start_date": f"{START_YEAR}0101", "end_date": "20240816"},
        "trade_date,north_money",
    )
    blocks = []
    holder_trades = []
    for start, end in month_ranges():
        blocks.extend(
            call_api_pages(
                token,
                "block_trade",
                {"start_date": start, "end_date": end},
                "ts_code,trade_date,amount,buyer,seller",
                page_size=1000,
            )
        )
        holder_trades.extend(
            call_api_pages(
                token,
                "stk_holdertrade",
                {"start_date": start, "end_date": end},
                "ts_code,ann_date,holder_name,in_de,change_vol,change_ratio,avg_price",
                page_size=3000,
            )
        )

    block_weeks = defaultdict(lambda: {"dates": [], "amount": 0.0, "instNet": 0.0})
    for row in blocks:
        key = week_key(row["trade_date"])
        amount = float(row.get("amount") or 0) / 10000
        item = block_weeks[key]
        item["dates"].append(row["trade_date"])
        item["amount"] += amount
        buyer_inst = "机构专用" in str(row.get("buyer") or "")
        seller_inst = "机构专用" in str(row.get("seller") or "")
        if buyer_inst and not seller_inst:
            item["instNet"] += amount
        elif seller_inst and not buyer_inst:
            item["instNet"] -= amount

    unique_holder_rows = {}
    for row in holder_trades:
        identity = (
            row.get("ts_code"),
            row.get("ann_date"),
            row.get("holder_name"),
            row.get("in_de"),
            row.get("change_vol"),
            row.get("change_ratio"),
        )
        unique_holder_rows[identity] = row
    holder_weeks = defaultdict(lambda: {"dates": [], "netShares": 0.0})
    for row in unique_holder_rows.values():
        date = row.get("ann_date")
        if not date:
            continue
        key = week_key(date)
        shares = float(row.get("change_vol") or 0) / 1e8
        signed = shares if row.get("in_de") == "IN" else -shares
        holder_weeks[key]["dates"].append(date)
        holder_weeks[key]["netShares"] += signed

    north_weeks = {}
    for row in sorted(north, key=lambda item: item["trade_date"]):
        key = week_key(row["trade_date"])
        north_weeks[key] = {
            "date": row["trade_date"],
            "northMoney": float(row.get("north_money") or 0) / 100,
        }

    keys = sorted(set(block_weeks) | set(holder_weeks) | set(north_weeks))
    series = []
    for key in keys:
        dates = []
        if key in block_weeks:
            dates.extend(block_weeks[key]["dates"])
        if key in holder_weeks:
            dates.extend(holder_weeks[key]["dates"])
        if key in north_weeks:
            dates.append(north_weeks[key]["date"])
        date = week_end_date(dates)
        block = block_weeks.get(key, {})
        holder = holder_weeks.get(key, {})
        north_row = north_weeks.get(key, {})
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "northDate": datetime.strptime(north_row["date"], "%Y%m%d").strftime("%Y-%m-%d") if north_row else None,
                "northMoney": round(north_row["northMoney"], 2)
                if "northMoney" in north_row
                else None,
                "blockAmount": round(block["amount"], 2) if block else None,
                "institutionBlockNet": round(block["instNet"], 2) if block else None,
                "holderNetShares": round(holder["netShares"], 4) if holder else None,
            }
        )

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "start": series[0]["date"],
            "end": series[-1]["date"],
            "northEnd": "2024-08-16",
            "sources": {
                "north": "Tushare moneyflow_hsgt",
                "block": "Tushare block_trade",
                "holder": "Tushare stk_holdertrade",
            },
        },
        "series": series,
    }
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(OUTPUT), "points": len(series)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
