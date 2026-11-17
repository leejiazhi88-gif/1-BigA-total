"""Recover missing financials with fresh secondary actuals and bounded estimates.

Raw receipts are immutable. Never infer zero from a blank, replace known actuals,
or let an incomplete company erase an industry without failing publication.
"""
import csv
import json
import math
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
FILE = 'financial-recovery.json'
SUFFIXES = ['0331', '0630', '0930', '1231']


def load(site=SITE):
    return json.loads((site / FILE).read_text())


def scopes(policy, latest):
    targets = {(c['code'], c['year'] + suffix) for c in policy['cases']
               for suffix in SUFFIXES if c['year'] + suffix <= latest}
    return targets, {c for c, _ in targets}


def discover(site, latest):
    """Scan every company, including old gaps and previously estimated history."""
    cases = {(r['code'], r['year']) for r in load(site)['cases']}
    previous = site / 'freshness-audit.json'
    if previous.exists():
        cases |= {(r['code'],r['year']) for r in json.loads(previous.read_text()).get('recoveryScope',{}).get('cases',[])}
    for item in json.loads((site / 'catalog.json').read_text())['industries']:
        with (site / item['path'] / 'company-quarterly.csv').open(encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                if r['status'] == 'missing' or (r['status'] == 'estimated' and r['endDate'] < latest):
                    cases.add((r['code'], r['endDate'][:4]))
    return dict(cases=[dict(code=c, year=y) for c, y in sorted(cases)])


def value(row, metric):
    if not row:
        return None
    return (row.get('total_revenue') if row.get('total_revenue') is not None else row.get('revenue')) if metric == 'revenue' else row.get('n_income_attr_p')


def secondary_actuals(reports, data, targets, asof):
    """Only missing fields; require agreement on every shared financial metric."""
    used = []
    for key, response in data.items():
        if not key.startswith('secondary:'):
            continue
        for external in response:
            code = external['SECUCODE']
            end = external['REPORT_DATE'][:10].replace('-', '')
            if (code, end) not in targets:
                continue
            announcement = (external.get('NOTICE_DATE') or '')[:10].replace('-', '')
            if not announcement or announcement > asof:
                continue
            incoming = {'revenue': external.get('TOTAL_OPERATE_INCOME') if external.get('TOTAL_OPERATE_INCOME') is not None else external.get('OPERATE_INCOME'), 'profit': external.get('PARENT_NETPROFIT')}
            original = reports.get((code, end))
            missing = [m for m in incoming if value(original, m) is None and incoming[m] is not None]
            if not missing:
                continue
            if original:
                for metric, amount in incoming.items():
                    current = value(original, metric)
                    if amount is not None and current is not None and not math.isclose(current, amount, rel_tol=1e-10, abs_tol=.02):
                        raise RuntimeError(f'{code} {end} 备用财务源与主源{metric}冲突，需核对原文。')
            row = reports.setdefault((code, end), dict(ts_code=code, end_date=end,
                ann_date=announcement, f_ann_date=announcement, report_type='1'))
            for metric in missing:
                amount = incoming[metric]
                if not math.isfinite(amount):
                    raise RuntimeError(f'{code} {end} 备用财务源非有限值')
                row['total_revenue' if metric == 'revenue' else 'n_income_attr_p'] = amount
            used.append(dict(code=code, period=end, metrics=missing, source='Eastmoney RPT_F10_FINANCE_GINCOME',
                             announcementDate=announcement, values={m:incoming[m] for m in missing}))
    return used


def interpolate(reports, code, end, metric):
    """Estimate a cumulative gap only between known same-year actual anchors.

Year start is a genuine cumulative zero. Estimates never become anchors, never
extrapolate beyond the last actual, and preserve known half-year/annual totals.
"""
    direct = value(reports.get((code, end)), metric)
    if direct is not None:
        return direct, None
    index = SUFFIXES.index(end[4:]) + 1
    anchors = [(0, 0., end[:4] + '0101')]
    for i, suffix in enumerate(SUFFIXES, 1):
        period = end[:4] + suffix
        amount = value(reports.get((code, period)), metric)
        if amount is not None and math.isfinite(amount):
            anchors.append((i, amount, period))
    lower = max((a for a in anchors if a[0] < index), default=None)
    upper = min((a for a in anchors if a[0] > index), default=None)
    if lower is None or upper is None or (metric == 'revenue' and upper[1] < lower[1]):
        return None, None
    amount = lower[1] + (upper[1]-lower[1]) * (index-lower[0]) / (upper[0]-lower[0])
    return amount, dict(metric=metric, missingPeriod=end, lowerPeriod=lower[2], lowerValue=lower[1],
                        upperPeriod=upper[2], upperValue=upper[1], estimatedCumulative=amount)


def historical_quarter(reports, code, end):
    """Return exact fields where possible; estimate only missing dependencies."""
    i = SUFFIXES.index(end[4:]); dependencies = []; result = {}
    for metric in ['revenue', 'profit']:
        current, note = interpolate(reports, code, end, metric)
        if current is None:
            return None
        if note:
            dependencies.append(note)
        previous = 0.
        if i:
            previous, note = interpolate(reports, code, end[:4] + SUFFIXES[i-1], metric)
            if previous is None:
                return None
            if note:
                dependencies.append(note)
        result[metric] = (current-previous) / 1e8
    if not dependencies:
        return None
    return dict(**result, method='historical_cumulative_interpolation', dependencies=dependencies,
                note='历史单季拆分估算：在同年已披露累计数之间按季度均分；保持已知累计总额，非实际单季财报。')


def audit(site=SITE):
    """All-company, all-quarter gate, not just the last financial quarter."""
    catalog = json.loads((site / 'catalog.json').read_text())
    estimates = []; rows_count = 0; gaps = []
    for item in catalog['industries']:
        root = site / item['path']
        with (root / 'company-quarterly.csv').open(encoding='utf-8-sig') as f:
            records = list(csv.DictReader(f))
        for r in records:
            rows_count += 1
            if r['status'] not in ['reported','estimated'] or any(r[k] in [None,''] or not math.isfinite(float(r[k])) for k in ['revenue','profit']):
                gaps.append(dict(industry=item['name'],code=r['code'],quarter=r['quarter']))
            if r['status'] == 'estimated':
                estimates.append(dict(industry=item['name'],code=r['code'],quarter=r['quarter']))
        for name in ['data.json','sectors.json']:
            d = json.loads((root / name).read_text())
            for g in [d] if name == 'data.json' else d['groups']:
                for r in g['series']:
                    if r['companies']:
                        assert not r['missingCount'], (item['name'],g.get('name'),r['quarter'],'行业财务缺口')
                        assert all(isinstance(r[k],(int,float)) and math.isfinite(r[k]) for k in ['revenue','profit'])
    if gaps:
        raise RuntimeError(f'全历史财务仍有 {len(gaps)} 条缺口，停止发布：{gaps[:8]}')
    return dict(companyQuarterRows=rows_count, unresolvedCount=0, estimatedRows=estimates)


if __name__ == '__main__':
    print(json.dumps(audit(),ensure_ascii=False,indent=2))
