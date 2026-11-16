#!/usr/bin/env python3
"""Publish the independent quanlantu repository; never write to the legacy site."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

SITE = Path(__file__).resolve().parents[1]
REMOTE = 'https://github.com/leejiazhi88-gif/2.2-quanlantu.git'

def git(*args, capture=False):
    return subprocess.run(['git', '-C', str(SITE), *args], check=True,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if git('branch', '--show-current', capture=True).strip() != 'main':
        sys.exit('请在独立仓库 main 分支发布。')
    if git('status', '--porcelain', capture=True).strip():
        sys.exit('请先提交本仓库修改，再发布。')
    origin=git('remote', 'get-url', 'origin', capture=True).strip().removesuffix('.git')
    allowed={REMOTE.removesuffix('.git'),'git@github.com:leejiazhi88-gif/2.2-quanlantu','ssh://git@github.com/leejiazhi88-gif/2.2-quanlantu'}
    if origin not in allowed:
        sys.exit('origin 不是全览图独立仓库，停止发布。')
    for check in ['validate_sw_data.py', 'check_freshness.py']:
        subprocess.run([sys.executable, str(SITE/'tools'/check)], check=True)
    git('fetch', 'origin', 'main')
    git('merge-base', '--is-ancestor', 'origin/main', 'HEAD')
    git('push', 'origin', 'main')
    commit = git('rev-parse', 'HEAD', capture=True).strip()
    remote = git('ls-remote', 'origin', 'refs/heads/main', capture=True).split()[0]
    if remote != commit:
        sys.exit('远端已更新，请检查最新提交后重试。')
    if args.output_dir:
        output = args.output_dir.resolve()
        if output == SITE or SITE in output.parents:
            sys.exit('导出目录需放在仓库外。')
        output.mkdir(parents=True, exist_ok=True)
        target = output/'quanlantu-site'
        shutil.copytree(SITE, target, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('.git', '__pycache__', '*.pyc'))
        shutil.make_archive(str(output/'quanlantu-site'), 'zip', root_dir=output, base_dir='quanlantu-site')
    print('独立仓库发布完成：' + commit)
    print('https://leejiazhi88-gif.github.io/2.2-quanlantu/')

if __name__ == '__main__':
    main()
