"""Fetch fresh public responses. Never reuse a previous day's response cache.

Credentials come from TUSHARE_TOKEN/TUSHARE_MCP_ENDPOINT or the local Codex
configuration; they are sent to curl on stdin and never saved in public data.
"""
import concurrent.futures as cf
from datetime import date, datetime, timedelta
import json
import gzip
import os
from pathlib import Path
import re
import subprocess
import threading
from zoneinfo import ZoneInfo

SITE = Path(__file__).resolve().parents[1]
FIN_FIELDS = 'ts_code,ann_date,f_ann_date,end_date,report_type,total_revenue,revenue,n_income_attr_p,update_flag'
SW_FIELDS = 'ts_code,trade_date,name,close,pe,pb,total_mv,float_mv,amount,vol,pct_change'


def today():
    return datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d')


def read(path):
    return json.loads(path.read_text())


class Client:
    def __init__(self, asof=None):
        self.asof = asof or today()
        self.endpoint = os.environ.get('TUSHARE_MCP_ENDPOINT')
        self.token = os.environ.get('TUSHARE_TOKEN')
        if not self.endpoint and not self.token:
            config = Path.home() / '.codex/config.toml'
            match = re.search(r'https://api\.tushare\.pro/mcp/\?token=[^\s\'"&]+', config.read_text()) if config.exists() else None
            self.endpoint = match.group(0) if match else None
        if not self.endpoint and not self.token:
            raise RuntimeError('需要已配置的 Tushare 凭据；没有查询新数据，停止刷新。')
        self.requests = []
        self.lock = threading.Lock()

    def call(self, api, params, fields='', cap=None):
        if self.endpoint:
            payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {
                'name': api, 'arguments': {**params, **({'fields': fields.split(',')} if fields else {})}}}
            endpoint = self.endpoint
        else:
            payload = dict(api_name=api, token=self.token, params=params, fields=fields)
            endpoint = 'https://api.tushare.pro'
        config = '\n'.join(['url = ' + json.dumps(endpoint), 'request = "POST"',
            'header = "Content-Type: application/json"', 'header = "Accept: application/json, text/event-stream"',
            'data = ' + json.dumps(json.dumps(payload, ensure_ascii=False))])
        proc = subprocess.run(['curl', '--silent', '--show-error', '--fail-with-body', '--max-time', '60',
            '--retry', '2', '--config', '-'], input=config, text=True, capture_output=True)
        if proc.returncode:
            raise RuntimeError(f'{api} 网络查询失败；未将旧数据当作新数据。')
        text = proc.stdout
        if text.lstrip().startswith('data:') or '\ndata: ' in text:
            text = next(line[6:] for line in text.splitlines() if line.startswith('data: '))
        response = json.loads(text)
        if self.endpoint:
            result = response.get('result', {})
            if 'error' in response or result.get('isError'):
                raise RuntimeError(f'{api} 接口报错，停止刷新。')
            rows = json.loads(result['content'][0]['text'])
        else:
            if response.get('code') != 0:
                raise RuntimeError(f'{api} 接口报错，停止刷新。')
            data = response['data']
            rows = [dict(zip(data['fields'], row)) for row in data['items']]
        if not isinstance(rows, list):
            raise RuntimeError(f'{api} 没有返回合法数据表，停止刷新。')
        receipt = dict(api=api, params=params, fields=fields.split(',') if fields else [], rows=rows,
            fetchedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'))
        with self.lock:
            self.requests.append(receipt)
        if cap is not None and len(rows) >= cap:
            receipt['truncated'] = True
            if api == 'income_vip' and params.get('period'):
                lo, hi = params.get('start_date', params['period'][:4]+'0101'), params.get('end_date', self.asof)
                first, last = [date.fromisoformat(d[:4]+'-'+d[4:6]+'-'+d[6:]) for d in [lo, hi]]
                if first < last:
                    mid = first + (last-first)//2
                    return self.call(api, {**params, 'start_date': lo, 'end_date': mid.strftime('%Y%m%d')}, fields, cap) + self.call(api, {**params, 'start_date': (mid+timedelta(days=1)).strftime('%Y%m%d'), 'end_date': hi}, fields, cap)
            raise RuntimeError(f'{api} 达到单次上限，不能把截断结果发布。')
        return rows


def collect(asof=None):
    asof = asof or today()
    assert asof == today(), '刷新入口只接受当前核查日；历史重建使用已保存响应'
    client = Client(asof)
    catalog = read(SITE / 'catalog.json')
    modules = {i['key']: read(SITE / i['path'] / 'data.json') for i in catalog['industries']}
    periods = sorted({r['endDate'] for d in modules.values() for r in d['series'][-7:]})
    latest_period = periods[-1]
    checked = read(SITE / 'freshness-audit.json')['checkedThrough'] if (SITE / 'freshness-audit.json').exists() else min(d['meta']['asOf'].replace('-', '') for d in modules.values())
    # Include the previous check day: feeds can ingest a report later that day.
    incremental = []
    for report in ['1', '4', '5']:
        incremental.extend(client.call('income_vip', dict(start_date=checked, end_date=asof, report_type=report), FIN_FIELDS, 9000))
    older_years = {r['end_date'][:4] for r in incremental if r['end_date'] < periods[0]}
    periods = sorted(set(periods) | {year + suffix for year in older_years for suffix in ['0331', '0630', '0930', '1231']})
    if any(r['end_date'] > latest_period for r in incremental):
        raise RuntimeError('发现更新的财报季度，需要先推进季度数据构建；停止发布旧季度刷新。')
    calendar = client.call('trade_cal', dict(exchange='SSE', start_date=(date.fromisoformat(asof[:4]+'-'+asof[4:6]+'-'+asof[6:])-timedelta(days=20)).strftime('%Y%m%d'), end_date=asof, is_open='1'))
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    available_days = [r['cal_date'] for r in calendar if r['cal_date'] < today() or now.strftime('%H%M') >= '1830']
    quote_day = max(available_days)  # sw_daily is published after 18:30, not intraday
    jobs = {}
    quote_codes = set()
    quote_starts = []
    jobs['basics'] = ('stock_basic', {'list_status': 'L'}, 'ts_code,name,list_date,list_status', 10000)
    jobs['companyQuotes'] = ('daily_basic', {'trade_date': quote_day}, 'ts_code,trade_date,total_mv', 6000)
    for i in catalog['industries']:
        jobs['members:' + i['code']] = ('index_member_all', {'l1_code': i['code'], 'is_new': 'Y'}, '', 7000)
        source = read(SITE / i['path'] / 'sw-source.json')
        quote_codes.update(source['indices'])
        base = date.fromisoformat(source['project2AsOf'][:4]+'-'+source['project2AsOf'][4:6]+'-'+source['project2AsOf'][6:])
        quote_starts.append((base+timedelta(days=1)).strftime('%Y%m%d'))
    quote_start = min(quote_starts)
    # One trading-day response includes all SW indices (under the 4,000-row cap).
    # This replaces 165 independent calls with one call per trading day. Re-read
    # the full supplement to capture corrections, rather than trust cached quotes.
    quote_calendar = calendar
    if quote_start < min(r['cal_date'] for r in calendar):
        quote_calendar = client.call('trade_cal', dict(exchange='SSE', start_date=quote_start, end_date=asof, is_open='1'))
    quote_days = sorted(r['cal_date'] for r in quote_calendar if quote_start <= r['cal_date'] <= quote_day)
    batch_quotes = len(quote_days) < len(quote_codes)
    if batch_quotes:
        for day in quote_days:
            jobs['quoteDay:' + day] = ('sw_daily', {'trade_date': day}, SW_FIELDS, 4000)
    else:
        for code in quote_codes:
            jobs['quote:' + code] = ('sw_daily', {'ts_code': code, 'start_date': quote_start, 'end_date': asof}, SW_FIELDS, 4000)
    for period in periods:
        for report in ['1', '4', '5']:
            jobs['income:' + period + ':' + report] = ('income_vip', {'period': period, 'report_type': report}, FIN_FIELDS, 9000)
    for d in modules.values():
        for c in d['latestCompanies']:
            if c['status'] != 'reported':
                jobs['disclosure:' + c['code']] = ('disclosure_date', {'ts_code': c['code'], 'end_date': latest_period}, '', 6000)
    result = {}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(client.call, *job): key for key, job in jobs.items()}
        for future in cf.as_completed(pending):
            key = pending[future]
            result[key] = future.result()
            if len(result) % 30 == 0:
                print(f'新查询 {len(result)}/{len(jobs)} 项', flush=True)
    if batch_quotes:
        for code in quote_codes:
            result['quote:' + code] = [r for day in quote_days for r in result['quoteDay:' + day] if r['ts_code'] == code]
    assert all(result['quote:' + i['code']] and any(r['trade_date'] == quote_day for r in result['quote:' + i['code']]) for i in catalog['industries']), '最新申万一级行情尚未齐备，停止刷新'
    quoted = {r['ts_code'] for r in result['companyQuotes'] if r.get('total_mv') is not None}
    missing_quotes = [r['ts_code'] for r in result['basics'] if r['ts_code'] not in quoted]
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(client.call, 'daily_basic', {'ts_code': code, 'start_date': '20050101', 'end_date': asof}, 'ts_code,trade_date,total_mv', 6000): code for code in missing_quotes}
        for future in cf.as_completed(pending):
            result['carry:' + pending[future]] = future.result()
    source = dict(asOf=asof, quoteDate=quote_day, latestPeriod=latest_period, periods=periods,
        incrementalStart=checked, incremental=incremental, data=result, requests=client.requests,
        collectedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'))
    with gzip.open(SITE / 'refresh-source.json.gz', 'wt', encoding='utf-8') as stream:
        json.dump(source, stream, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    print(f'已保存 {len(client.requests)} 项新查询；行情日 {quote_day}；财报期 {latest_period}', flush=True)
    return source


if __name__ == '__main__':
    collect()
