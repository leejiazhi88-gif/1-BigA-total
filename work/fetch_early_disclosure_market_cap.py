"""Add period-matched total A-share market cap for verified early holdings."""

import json
import urllib.request

from fetch_a_share_market_cap import build_period, cached_api
from fetch_national_team_stock_history import ROOT, read, save
from tushare_client import get_token

BASE = "cf258b48f8ea5c99bb3cd9ea2ffaed88d0422236"


def main():
    periods = sorted(p for p in read(ROOT / "work/national_team_stock_history.json")["stocks"] if p < "20150000")
    original = f"https://raw.githubusercontent.com/leejiazhi88-gif/1-BigA-total/{BASE}/work/a_share_market_cap.json"
    result = json.load(urllib.request.urlopen(original, timeout=60))
    token = get_token()
    calendar = cached_api(token, "trade_cal", {"exchange": "SSE", "start_date": periods[0], "end_date": periods[-1]},
                          "cal_date,is_open,pretrade_date")
    dates = {row["cal_date"]: row["cal_date"] if row["is_open"] else row["pretrade_date"] for row in calendar}
    beijing = read(ROOT / "work/bse_market_cap_history.json")
    for period in periods:
        date = dates[period]
        sh = cached_api(token, "daily_info", {"trade_date": date, "exchange": "SH"}, "trade_date,ts_code,com_count,total_mv")
        sz = cached_api(token, "sz_daily_info", {"trade_date": date}, "trade_date,ts_code,count,total_mv")
        result["periods"][period] = build_period(period, date, sh, sz, beijing)
        print(json.dumps({"period": period, "amount": result["periods"][period]["amount"]}), flush=True)
    result["periods"] = dict(sorted(result["periods"].items()))
    save(ROOT / "work/a_share_market_cap.json", result)


if __name__ == "__main__":
    main()
