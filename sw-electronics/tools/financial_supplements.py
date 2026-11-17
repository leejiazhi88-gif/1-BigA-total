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
    assert len({(r['code'], r['period'], r['metric']) for r in records}) == len(records)
    for r in records:
        assert r['metric'] in ['revenue', 'profit'] and r['basis'] == 'reported_cumulative'
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
    originals = {key: dict(row) for key, row in reports.items()}
    for supplement in records:
        code, end = supplement['code'], supplement['period']
        if end > asof:
            continue
        original = originals.get((code, end))
        expected = supplement['expectedSource']
        if original is None and not expected.get('missingReport'):
            raise RuntimeError(f'{code} {end} 补充项缺少新报表响应，停止发布。')
        row = reports.get((code, end))
        same_version = original is None if expected.get('missingReport') else original is not None and (original.get('f_ann_date') or original.get('ann_date')) == expected['announcementDate'] and str(original['report_type']) == expected['reportType']
        value = ((row.get('total_revenue') if row.get('total_revenue') is not None else row.get('revenue')) if supplement['metric'] == 'revenue' else row.get('n_income_attr_p')) if row else None
        if value is not None:
            # A newer actual disclosure supersedes the supplement. A conflict
            # in the reviewed version needs investigation, never an overwrite.
            if same_version and not math.isclose(value, supplement['value'], rel_tol=0, abs_tol=.005):
                raise RuntimeError(f'{code} {end} 接口与已核对原文冲突，需重新核查。')
            continue
        profit = original.get('n_income_attr_p') if original else None
        expected_profit = expected.get('profit')
        profit_matches = profit is None and expected_profit is None or profit is not None and expected_profit is not None and math.isclose(profit, expected_profit, rel_tol=0, abs_tol=.005)
        if not same_version or not profit_matches:
            raise RuntimeError(f'{code} {end} 财报版本或利润已变化，不能沿用旧原文补充。')
        assert all(e['announcementDate'] <= asof for e in supplement['evidence'])
        if row is None:
            announcement = supplement['evidence'][0]['announcementDate']
            row = reports.setdefault((code, end), dict(ts_code=code, end_date=end,
                ann_date=announcement, f_ann_date=announcement, report_type='1'))
        row['total_revenue' if supplement['metric']=='revenue' else 'n_income_attr_p'] = supplement['value']
        applied.append(supplement)
    return applied
