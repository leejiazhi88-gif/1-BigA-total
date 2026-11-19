#!/usr/bin/env python3
"""Install the local scheduler; no credentials are stored in its plist."""
import argparse
from datetime import datetime
from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys
from zoneinfo import ZoneInfo

LABEL = 'com.quanlantu.daily-refresh'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--start-tomorrow', action='store_true', help='Skip today after a manual installation check')
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    state = Path.home() / 'Library/Application Support/QuanlantuDaily'
    state.mkdir(parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    runner = state / 'daily_refresh.py'
    shutil.copy2(Path(__file__).with_name('daily_refresh.py'), runner)
    if args.start_tomorrow:
        current = datetime.now(ZoneInfo('Asia/Shanghai'))
        marker = state / 'last-attempt.json'
        temporary = marker.with_suffix('.tmp')
        temporary.write_text(json.dumps(dict(date=current.strftime('%Y-%m-%d'),
            startedAt=current.isoformat(timespec='seconds'), note='安装当天已手动核查，从次日16:30开始定时执行。'), ensure_ascii=False) + '\n')
        temporary.replace(marker)
    config = dict(Label=LABEL,
        ProgramArguments=[sys.executable, str(runner), '--workspace', str(workspace)],
        # A cheap local clock guard makes the schedule independent of the Mac's
        # timezone. It starts network work only once/day at/after 16:30 Shanghai.
        StartInterval=60, RunAtLoad=True, ProcessType='Background',
        WorkingDirectory=str(state),
        EnvironmentVariables=dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin', TZ='Asia/Shanghai',
                                  GIT_TERMINAL_PROMPT='0', PYTHONUNBUFFERED='1'),
        StandardOutPath=str(state / 'scheduler.log'), StandardErrorPath=str(state / 'scheduler-error.log'))
    folder = Path.home() / 'Library/LaunchAgents'
    folder.mkdir(exist_ok=True)
    path = folder / (LABEL + '.plist')
    path.write_bytes(plistlib.dumps(config))
    subprocess.run(['plutil', '-lint', str(path)], check=True)
    service = f'gui/{os.getuid()}/{LABEL}'
    loaded = subprocess.run(['launchctl', 'print', service], capture_output=True).returncode == 0
    if loaded:
        subprocess.run(['launchctl', 'bootout', service], check=True)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
    subprocess.run(['launchctl', 'enable', service], check=True)
    print('Installed:', path)
    print('Daily refresh: 16:30 Asia/Shanghai; once per day, no same-day retry.')
    print('Reports:', state / 'latest-report.json')


if __name__ == '__main__':
    main()
