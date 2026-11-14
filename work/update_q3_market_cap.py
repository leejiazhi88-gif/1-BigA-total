"""Append independently sourced Q3 exchange market totals."""
from fetch_a_share_market_cap import cached_api, build_period, get_token, read, save, ROOT, OUTPUT

token = get_token()
date = '20260930'
sh = cached_api(token, 'daily_info', {'trade_date': date, 'exchange': 'SH'}, 'trade_date,ts_code,com_count,total_mv')
sz = cached_api(token, 'sz_daily_info', {'trade_date': date}, 'trade_date,ts_code,count,total_mv')
daily = cached_api(token, 'daily_basic', {'trade_date': date}, 'ts_code,trade_date,total_mv')
bj = [r for r in daily if r['ts_code'].endswith('.BJ')]
if len(bj) != len({r['ts_code'] for r in bj}) or len(bj) != 348 or any(r['trade_date'] != date or not r['total_mv'] for r in bj):
    raise ValueError('Incomplete or duplicated Beijing market totals')
beijing = {'marketOpened': '20211115', 'source': 'Tushare daily_basic: sum of all 348 Beijing-listed A shares, total_mv in CNY 10,000',
           'rows': [{'trade_date': date, 'amount': sum(r['total_mv'] for r in bj) / 10000, 'count': len(bj)}]}
result = build_period(date, date, sh, sz, beijing)
data = read(OUTPUT)
data['periods'][date] = result
data['checkedAt'] = '2026-11-14'
save(OUTPUT, data)
print(result)
