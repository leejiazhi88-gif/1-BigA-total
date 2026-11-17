"""Reviewed issuer disclosures fill missing cumulative fields, never raw receipts.

A blank is not zero. Each supplement is bound to a reviewed report version and
profit cross-check. Re-query its period and cumulative-difference dependencies
on every refresh, including after it leaves the normal recent-period window.
"""
import json
import math
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
FILE = 'financial-supplements.json'
SUFFIXES = ['0331', '0630', '0930', '1231']


def load(site=SITE):
    records = json.loads((site / FILE).read_text())['records']
    assert len({(r['code'], r['period']) for r in records}) == len(records)
    for r in records:
        assert r['metric'] == 'revenue' and r['basis'] == 'reported_cumulative'
        assert math.isfinite(r['value']) and r['evidence']
        assert r['period'][4:] in SUFFIXES
        for e in r['evidence']:
            assert e['url'].startswith('https://') and len(e['sha256']) == 64
            assert e['pages'] and e['excerpt']
    return records


def scopes(records, latest):
    """Return affected quarterly rows and cumulative reports needed for them."""
    targets = set()
    for r in records:
        code, end = r['code'], r['period']
        targets.add((code, end))
        i = SUFFIXES.index(end[4:])
        if i < 3:
            targets.add((code, end[:4] + SUFFIXES[i+1]))
    targets = {pair for pair in targets if pair[1] <= latest}
    dependencies = set(targets)
    for code, end in targets:
        i = SUFFIXES.index(end[4:])
        if i:
            dependencies.add((code, end[:4] + SUFFIXES[i-1]))
    return targets, dependencies


def apply(reports, records, asof):
    """Mutate selected copies only; return provenance for actually filled fields."""
    applied = []
    for supplement in records:
        code, end = supplement['code'], supplement['period']
        if end > asof:
            continue
        row = reports.get((code, end))
        if row is None:
            raise RuntimeError(f'{code} {end} 补充项缺少新报表响应，停止发布。')
        expected = supplement['expectedSource']
        same_version = (row.get('f_ann_date') or row.get('ann_date')) == expected['announcementDate'] and str(row['report_type']) == expected['reportType']
        value = row.get('total_revenue') if row.get('total_revenue') is not None else row.get('revenue')
        if value is not None:
            # A newer actual disclosure supersedes the supplement. A conflict
            # in the reviewed version needs investigation, never an overwrite.
            if same_version and not math.isclose(value, supplement['value'], rel_tol=0, abs_tol=.005):
                raise RuntimeError(f'{code} {end} 接口与已核对原文冲突，需重新核查。')
            continue
        profit = row.get('n_income_attr_p')
        if not same_version or profit is None or not math.isclose(profit, expected['profit'], rel_tol=0, abs_tol=.005):
            raise RuntimeError(f'{code} {end} 财报版本或利润已变化，不能沿用旧原文补充。')
        assert all(e['announcementDate'] <= asof for e in supplement['evidence'])
        row['total_revenue'] = supplement['value']
        applied.append(supplement)
    return applied
