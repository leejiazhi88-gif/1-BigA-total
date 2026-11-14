"""Refresh recent original ETF reports while preserving audited history."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import fetch_national_team_etf_history as history


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='20260630')
    parser.add_argument('--as-of', required=True)
    args = parser.parse_args()
    data = json.loads(history.OUTPUT.read_text(encoding='utf-8'))
    history.START = args.start
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda code: history.collect(args.as_of, [code], True), history.FUNDS))
    rows = [row for batch, _ in results for row in batch]
    failures = [row for _, errors in results for row in errors]
    issues = [row for row in rows if row['issues']]
    history.save(history.CACHE / 'recent-audit.json', {'reports': rows, 'failures': failures})
    if failures or issues:
        raise ValueError(f'Unresolved reports: {len(failures)} downloads, {len(issues)} parsing')
    for code in history.FUNDS:
        if not any(r['code'] == code and r['period'] == '20260930' for r in rows):
            raise ValueError('Missing Q3 report: ' + code)
    merged = {(r['code'], r['period'], r['kind']): r for r in data['reports']}
    merged.update({(r['code'], r['period'], r['kind']): r for r in rows})
    data['reports'] = sorted(merged.values(), key=lambda r: (r['period'], r['code'], r['kind']))
    data['summaries'] = [history.summarize_period(data['reports'], data['funds'], p) for p in data['periods']]
    data['checked_at'] = f'{args.as_of[:4]}-{args.as_of[4:6]}-{args.as_of[6:]}'
    history.save(history.OUTPUT, data)
    print(json.dumps(data['summaries'][-3:], ensure_ascii=False))


if __name__ == '__main__':
    main()
