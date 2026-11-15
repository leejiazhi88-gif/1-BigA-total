"""Probe the latest quarterly holdings against existing full-portfolio criteria."""
import json
import fetch_large_money_fund_metrics as metrics

metrics.CACHE = metrics.CACHE / metrics.TODAY
token = metrics.get_token()
basic = metrics.basics(token)
funds = {code: fund for code, fund in basic.items() if metrics.is_active(fund)}
period = max(f'{year}{quarter}' for year in range(2005, int(metrics.END_DATE[:4]) + 1)
             for quarter in ('0331', '0630', '0930', '1231') if f'{year}{quarter}' < metrics.END_DATE)
nav = []
for market in ('E', 'O'):
    nav.extend(metrics.request(token, 'fund_nav', {'nav_date': period, 'market': market}, 'ts_code,nav_date,net_asset'))
holdings = metrics.request(token, 'fund_portfolio', {'period': period}, 'ts_code,ann_date,end_date,symbol,mkv,stk_mkv_ratio')
point = metrics.aggregate_report(period, funds, nav, holdings)
result = {'checkedAt': metrics.TODAY, 'quarter': period, 'portfolioRows': len(holdings),
          'qualifiedFunds': point['funds'], 'navFunds': point['navFunds'], 'coverage': point['coverage'],
          'threshold': 40, 'sameMethodAvailable': point['all']['position'] is not None,
          'point': point,
          'note': 'Diagnostic only. A quarter must not be spliced into the semiannual complete-portfolio series using only top-ten positions.'}
metrics.write_json(metrics.ROOT / 'outputs/active-fund-latest-report-audit.json', result)
metrics.write_json(metrics.ROOT / 'work/active_fund_report_audit.json', result)
print(json.dumps({k: v for k, v in result.items() if k != 'point'}, ensure_ascii=False), flush=True)
