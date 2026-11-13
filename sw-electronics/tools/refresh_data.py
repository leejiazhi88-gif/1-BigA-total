"""One refresh entry point: fresh network -> rebuild -> validate -> seal.

No-change runs still query the network and verify every payload. Only generation
is skipped, and only when the date and all normalized source rows are identical.
"""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
sys.dont_write_bytecode=True
from collect_refresh import collect

SITE=Path(__file__).resolve().parents[1]

def signature(source):
    payload={k:source[k] for k in ['asOf','quoteDate','latestPeriod','periods']}
    payload['builderSha256']={name:hashlib.sha256((SITE/'tools'/name).read_bytes()).hexdigest() for name in ['apply_refresh.py','align_sw_data.py','build_latest_quotes.py','update_snapshot_metadata.py']}
    payload['data']={k:sorted(rows,key=lambda r:json.dumps(r,sort_keys=True,ensure_ascii=False)) for k,rows in source['data'].items() if not k.startswith('quoteDay:')}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def run(name,*args):
    subprocess.run([sys.executable,str(SITE/'tools'/name),*args],check=True)

def main():
    started=time.monotonic()
    old=None
    audit_path=SITE/'freshness-audit.json'
    if audit_path.exists():old=json.loads(audit_path.read_text())
    source=collect()
    fingerprint=signature(source)
    # Receipt changes alone are not a reason to regenerate unchanged chart data.
    if old and old.get('buildInputSha256')==fingerprint:
        old.update(fetchedAt=source['collectedAt'],requests=len(source['requests']))
        audit_path.write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n')
        print('来源内容和日期均未变化，跳过重复构建；仍执行完整校验。',flush=True)
    else:
        run('apply_refresh.py')
    run('validate_sw_data.py')
    audit=json.loads(audit_path.read_text())
    audit['buildInputSha256']=fingerprint
    audit['refreshElapsedSeconds']=round(time.monotonic()-started,2)
    audit['collectionMode']='parallel-4; SW daily batch when cheaper; fresh financial periods + incremental corrections; no cache fallback'
    audit_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    run('check_freshness.py','--seal')
    run('check_freshness.py')
    print(f'刷新与校验完成，共 {time.monotonic()-started:.1f} 秒。')

if __name__=='__main__':main()
