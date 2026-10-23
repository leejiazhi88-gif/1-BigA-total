import json
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "market_overview_data.json"
START_YEAR = 2006



def fetch_by_year(token, api_name, ts_code, fields):
    end_year = int(END_DATE[:4])
    rows = []
    for year in range(START_YEAR, end_year + 1):
        end_date = END_DATE if year == end_year else f"{year}1231"
        rows.extend(
            call_api(
                token,
                api_name,
                {
                    "ts_code": ts_code,
                    "start_date": f"{year}0101",
                    "end_date": end_date,
                },
                fields,
            )
        )
    unique = {row["trade_date"]: row for row in rows}
    return [unique[date] for date in sorted(unique)]


def build_market(token, ts_code, prices=None):
    if prices is None:
        prices = fetch_by_year(token, "index_daily", ts_code, "trade_date,close")
    basics = fetch_by_year(
        token, "index_dailybasic", ts_code, "trade_date,pe_ttm,total_mv"
    )
    basic_by_date = {
        row["trade_date"]: {
            "pe": float(row["pe_ttm"]),
            "totalMv": float(row["total_mv"]),
        }
        for row in basics
        if row.get("pe_ttm")
        and float(row["pe_ttm"]) > 0
        and row.get("total_mv")
        and float(row["total_mv"]) > 0
    }
    series = []
    for row in prices:
        date = row["trade_date"]
        basic = basic_by_date.get(date)
        if not basic:
            continue
        pe = basic["pe"]
        close = float(row["close"])
        profit = basic["totalMv"] / pe / 100000000
        series.append(
            {
                "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                "close": close,
                "pe": pe,
                "profit": profit,
            }
        )
    return series


def build_trading(token):
    markets = []
    for code in ("000002.SH", "399107.SZ"):
        rows = fetch_by_year(token, "index_daily", code, "trade_date,vol,amount")
        markets.append({row["trade_date"]: row for row in rows})
    series = []
    for date in sorted(set(markets[0]) & set(markets[1])):
        rows = [market[date] for market in markets]
        if any(row.get(field) is None for row in rows for field in ("vol", "amount")):
            continue
        series.append({
            "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
            "volume": round(sum(float(row["vol"]) for row in rows) / 1e6, 4),
            "amount": round(sum(float(row["amount"]) for row in rows) / 1e5, 4),
        })
    if not series:
        raise RuntimeError("No complete Shanghai/Shenzhen A-share trading data returned.")
    return series


def main():
    token = get_token()
    codes = {"sh": "000001.SH", "sz": "399001.SZ"}
    prices = {market: fetch_by_year(token, "index_daily", code, "trade_date,close")
              for market, code in codes.items()}
    result = {
        "meta": {"requestedEnd": END_DATE},
        **{market: build_market(token, code, prices[market]) for market, code in codes.items()},
        "prices": {market: [{"date": f"{row['trade_date'][:4]}-{row['trade_date'][4:6]}-{row['trade_date'][6:]}",
                              "close": float(row["close"])} for row in rows if row.get("close") is not None]
                   for market, rows in prices.items()},
        "trading": build_trading(token),
    }
    result["meta"].update({
        "end": max(result["prices"]["sh"][-1]["date"], result["prices"]["sz"][-1]["date"], result["trading"][-1]["date"]),
        "priceEnd": {market: rows[-1]["date"] for market, rows in result["prices"].items()},
        "valuationEnd": {market: result[market][-1]["date"] for market in codes},
        "tradingSource": "Tushare index_daily: 000002.SH + 399107.SZ",
        "tradingScope": "Shanghai and Shenzhen A shares; excludes B shares, Beijing, funds and bonds",
        "volumeUnit": "亿股", "amountUnit": "亿元",
        "conversion": "vol (hands of 100 shares) / 1e6; amount (thousand CNY) / 1e5",
    })
    OUTPUT.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "sh_points": len(result["sh"]),
                "sz_points": len(result["sz"]),
                "latest_sh": result["sh"][-1],
                "latest_sz": result["sz"][-1],
                "price_end": result["meta"]["priceEnd"],
                "trading_end": result["trading"][-1]["date"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
