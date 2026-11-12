#!/usr/bin/env python3
"""Publish committed 全览图 changes to both GitHub repositories and local mirrors."""
from pathlib import Path
import shutil
import subprocess
import sys

workspace = next((parent for parent in Path(__file__).resolve().parents
                  if (parent / 'work/deploy/sw-electronics').is_dir()), None)
if workspace is None:
    sys.exit('请在全览图原工作区运行同步脚本；需存在 work/deploy/sw-electronics。')
deploy = workspace / 'work/deploy'
site = deploy / 'sw-electronics'
checkout = workspace / 'work/quanlantu'
remote = 'git@github.com:leejiazhi88-gif/2.2-quanlantu.git'

def git(directory, *args, capture=False):
    return subprocess.run(['git', '-C', str(directory), *args], check=True,
                          text=True, stdout=subprocess.PIPE if capture else None).stdout

if git(deploy, 'branch', '--show-current', capture=True).strip() != 'main':
    sys.exit('请先切换 work/deploy 到 main。')
if git(deploy, 'status', '--porcelain', '--', 'sw-electronics', capture=True).strip():
    sys.exit('请先校验并提交 sw-electronics 的修改，再运行同步。')
if checkout.exists() and git(checkout, 'status', '--porcelain', capture=True).strip():
    sys.exit('work/quanlantu 有未提交修改，请先合并到主编辑目录，避免覆盖。')

git(deploy, 'push', 'origin', 'main')
commit = git(deploy, 'subtree', 'split', '--prefix=sw-electronics', capture=True).strip()
git(deploy, 'push', remote, commit + ':refs/heads/main')
if checkout.exists():
    git(checkout, 'pull', '--ff-only', 'origin', 'main')
else:
    subprocess.run(['git', 'clone', '--branch', 'main', remote, str(checkout)], check=True)
source_tree = git(deploy, 'rev-parse', 'HEAD:sw-electronics', capture=True).strip()
local_tree = git(checkout, 'rev-parse', 'HEAD^{tree}', capture=True).strip()
remote_commit = git(checkout, 'ls-remote', 'origin', 'refs/heads/main', capture=True).split()[0]
if local_tree != source_tree or remote_commit != commit:
    sys.exit('同步校验失败，请检查本地与远端状态。')
shutil.copytree(site, workspace / 'outputs/sw-electronics', dirs_exist_ok=True)
shutil.make_archive(str(workspace / 'outputs/sw-electronics-site'), 'zip',
                    root_dir=workspace / 'outputs', base_dir='sw-electronics')
print('同步完成：原公开站点仓库、新全览图仓库、本地独立副本和交付文件。')
print('全览图仓库提交：' + commit)
