#!/usr/bin/env python3
"""One local 16:30 Shanghai refresh, staged away from editable repositories.

Logs/state stay in the user's Library, never in public site data. Missing source
data causes a single skipped publication; tomorrow rechecks since the last
successful financial audit. No second daily refresh or automatic time change.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo('Asia/Shanghai')
STATE_DIR = Path.home() / 'Library/Application Support/QuanlantuDaily'
EXCLUDED_LEGACY = {'index.html', 'README.md', 'AGENTS.md'}


def now():
    return datetime.now(SHANGHAI)


def schedule_due(current, previous_date):
    local = current.astimezone(SHANGHAI)
    return local.strftime('%H:%M') >= '16:30' and previous_date != local.strftime('%Y-%m-%d')


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args], text=True).strip()


def clean(directory, scope=None):
    if git(directory, 'branch', '--show-current') != 'main':
        raise RuntimeError('仓库不在main分支，保留现场并跳过。')
    args = ['status', '--porcelain'] + (['--', scope] if scope else [])
    if git(directory, *args):
        raise RuntimeError('检测到用户未提交修改，保留现场并跳过。')


def coverage(site):
    # Use the same client/fields as the full refresh, without storing credentials.
    sys.path.insert(0, str(site / 'tools'))
    from collect_refresh import Client, latest_quote_day
    client = Client()
    current = now()
    day = current.strftime('%Y%m%d')
    calendar = client.call('trade_cal', dict(exchange='SSE',
        start_date=(current - timedelta(days=25)).strftime('%Y%m%d'), end_date=day, is_open='1'))
    target = latest_quote_day(calendar, current)
    with ThreadPoolExecutor(max_workers=2) as pool:
        sw_job = pool.submit(client.call, 'sw_daily', {'trade_date': target},
                             'ts_code,trade_date,total_mv,pe', 4000)
        company_job = pool.submit(client.call, 'daily_basic', {'trade_date': target},
                                  'ts_code,trade_date,total_mv,pe_ttm', 6000)
        sw, companies = sw_job.result(), company_job.result()
    catalog = json.loads((site / 'catalog.json').read_text())['industries']
    required_l1 = {item['code'] for item in catalog}
    required_l2, required_companies = set(), set()
    for item in catalog:
        root = site / item['path']
        data = json.loads((root / 'data.json').read_text())
        sectors = json.loads((root / 'sectors.json').read_text())['groups']
        required_l2 |= {g['code'] for g in sectors if g.get('latestQuote', {}).get('marketCap') is not None}
        required_companies |= {c['code'] for c in data['latestCompanies']}
    received_sw = {r['ts_code'] for r in sw if r.get('trade_date') == target and (r.get('total_mv') or 0) > 0}
    received_companies = {r['ts_code'] for r in companies if r.get('trade_date') == target and (r.get('total_mv') or 0) > 0}
    def result(required, received):
        matched = required & received
        return dict(expected=len(required), received=len(matched),
                    ratio=len(matched) / len(required) if required else 1,
                    missing=sorted(required - received))
    l1, l2, individual = result(required_l1, received_sw), result(required_l2, received_sw), result(required_companies, received_companies)
    # This gate only prevents obviously incomplete acquisition. Full refresh
    # still checks members, delistings, suspensions, reports, corrections, hashes.
    ready = l1['ratio'] == 1 and l2['ratio'] == 1 and individual['ratio'] >= .99
    return dict(checkedAt=current.isoformat(timespec='seconds'), targetTradeDate=target,
                firstLevel=l1, secondLevel=l2, companies=individual, ready=ready)


def publish(workspace, site, legacy, stage, initial_heads):
    # User edits or incoming remote commits during acquisition stop promotion.
    for directory, (head, remote) in zip([site, legacy], initial_heads):
        clean(directory)
        subprocess.run(['git', '-C', str(directory), 'fetch', 'origin', 'main'], check=True)
        if git(directory, 'rev-parse', 'HEAD') != head or git(directory, 'rev-parse', 'origin/main') != remote:
            raise RuntimeError('取数期间本地或远端有新修改，停止合入并保留已核查暂存结果。')
    changed = []
    # Only already tracked site files can be published by this unattended job.
    for name in git(site, 'ls-files').splitlines():
        new, original = stage / name, site / name
        if not new.is_file() or new.read_bytes() == original.read_bytes():
            continue
        if name not in EXCLUDED_LEGACY:
            mirror = legacy / 'sw-electronics' / name
            if mirror.exists() and mirror.read_bytes() != original.read_bytes():
                raise RuntimeError(f'两个本地副本存在未合并差异：{name}')
        changed.append(name)
    for name in changed:
        shutil.copy2(stage / name, site / name)
        if name not in EXCLUDED_LEGACY:
            target = legacy / 'sw-electronics' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(stage / name, target)
    for directory, names in [(site, changed), (legacy, ['sw-electronics/' + n for n in changed if n not in EXCLUDED_LEGACY])]:
        if not names:
            continue
        subprocess.run(['git', '-C', str(directory), 'diff', '--check'], check=True)
        subprocess.run(['git', '-C', str(directory), 'add', '--', *names], check=True)
        subprocess.run(['git', '-C', str(directory), 'commit', '-m',
                        'Refresh overview data ' + now().strftime('%Y-%m-%d')], check=True)
    subprocess.run([sys.executable, str(workspace / 'sync-site.py')], cwd=workspace, check=True)
    return git(site, 'rev-parse', 'HEAD')


def run(args, report):
    workspace = args.workspace.resolve()
    site, legacy = workspace / 'work/quanlantu', workspace / 'work/deploy'
    clean(site)
    clean(legacy)
    for directory in [site, legacy]:
        subprocess.run(['git', '-C', str(directory), 'fetch', 'origin', 'main'], check=True)
        subprocess.run(['git', '-C', str(directory), 'merge', '--ff-only', 'origin/main'], check=True)
    report['coverage'] = coverage(site)
    save(args.report, report)
    if not report['coverage']['ready']:
        report['status'] = 'data_not_ready'
        report['note'] = '当天仅检查一次；保留线上完整版本，次日补查，不自动改时。'
        return
    if args.preflight_only:
        report['status'] = 'preflight_passed'
        return
    # A prior interrupted push may leave local commits ahead. Preserve them and
    # publish with the next validated refresh, provided neither side changes.
    heads = [(git(p, 'rev-parse', 'HEAD'), git(p, 'rev-parse', 'origin/main')) for p in [site, legacy]]
    # Refresh in an isolated export; a failed build cannot dirty either checkout.
    stage_parent = Path(tempfile.mkdtemp(prefix='build-', dir=STATE_DIR))
    report['stagedBuild'] = str(stage_parent)
    archive = stage_parent / 'site.tar'
    subprocess.run(['git', '-C', str(site), 'archive', '--format=tar', '-o', str(archive), 'HEAD'], check=True)
    stage = stage_parent / 'site'
    stage.mkdir()
    with tarfile.open(archive) as source:
        source.extractall(stage, filter='data')
    archive.unlink()
    subprocess.run([sys.executable, 'tools/refresh_data.py'], cwd=stage, check=True)
    if args.no_publish:
        report['status'] = 'validated_without_publication'
        return
    report['commit'] = publish(workspace, site, legacy, stage, heads)
    report['status'] = 'published'
    shutil.rmtree(stage_parent)
    report.pop('stagedBuild', None)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--run-now', action='store_true', help='Manual verification; does not consume the scheduled daily slot')
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--no-publish', action='store_true')
    args = parser.parse_args()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    with (STATE_DIR / 'run.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        current = now()
        date = current.strftime('%Y-%m-%d')
        marker = STATE_DIR / 'last-attempt.json'
        if not args.run_now:
            # Run at 16:30, or once upon waking later that day. No same-day retry.
            previous_date = json.loads(marker.read_text())['date'] if marker.exists() else None
            if not schedule_due(current, previous_date):
                return
            save(marker, dict(date=date, startedAt=current.isoformat(timespec='seconds')))
        stamp = current.strftime('%Y%m%d-%H%M%S')
        args.report = STATE_DIR / 'reports' / (stamp + '.json')
        report = dict(startedAt=current.isoformat(timespec='seconds'), schedule='16:30 Asia/Shanghai daily',
                      manual=args.run_now, status='running')
        started = time.monotonic()
        logs = STATE_DIR / 'logs'
        logs.mkdir(exist_ok=True)
        with (logs / (stamp + '.log')).open('a', buffering=1) as log:
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
            try:
                run(args, report)
            except Exception as error:
                report['status'] = 'failed'
                # Log only our concise errors, not credentials/raw HTTP payloads.
                report['error'] = str(error)
            finally:
                report['finishedAt'] = now().isoformat(timespec='seconds')
                report['elapsedSeconds'] = round(time.monotonic() - started, 2)
                save(args.report, report)
                save(STATE_DIR / 'latest-report.json', report)
                print(json.dumps(report, ensure_ascii=False), flush=True)
        return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
