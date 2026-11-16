"""Recoverable refresh jobs and verifiable same-run retries."""
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from contextlib import contextmanager
from pathlib import Path


EXTRA_OUTPUTS = {
    "refinancing": ["work/refinancing_issuance_records.json"],
    "fund_report_audit": ["outputs/active-fund-latest-report-audit.json"],
}
SUCCESS = {"ok", "reused_success"}


def outputs_for(job):
    key, cache, _, _ = job
    return ["work/" + cache, *EXTRA_OUTPUTS.get(key, [])]


def fingerprints(root, names):
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            if (root / name).exists() else None for name in names}


def code_signature(root):
    digest = hashlib.sha256()
    for source in sorted((root / "work").glob("*.py")):
        if source.name.startswith("test_"):
            continue
        digest.update(source.name.encode())
        digest.update(source.read_bytes())
    return digest.hexdigest()


def reusable(record, job, root, signature):
    expected = outputs_for(job)
    return (record.get("status") in SUCCESS and record.get("codeSignature") == signature
            and record.get("command") == [job[2], *job[3]]
            and set(record.get("outputs", {})) == set(expected)
            and all(record["outputs"].values())
            and record["outputs"] == fingerprints(root, expected))


def restore(path, content):
    if content is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(content)
        temporary = Path(handle.name)
    temporary.replace(path)


def validate_history(previous, current, end):
    cutoff = (datetime.strptime(end, "%Y%m%d") - timedelta(days=35)).strftime("%Y-%m-%d")
    def walk(old, new, label):
        if isinstance(old, dict):
            for key, value in old.items():
                if key != "meta" and isinstance(value, (list, dict)):
                    walk(value, new.get(key) if isinstance(new, dict) else None, label + "." + key)
        elif isinstance(old, list) and old and all(isinstance(row, dict) and isinstance(row.get("date"), str) for row in old):
            dates = {row["date"] for row in old if row["date"] < cutoff}
            observed = {row.get("date") for row in new} if isinstance(new, list) else set()
            if dates - observed:
                raise ValueError("Refresh lost historical dates: " + label + " " + str(sorted(dates - observed)[:3]))
    walk(previous, current, "dataset")


@contextmanager
def refresh_lock(path):
    import fcntl
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another refresh is running; refusing concurrent writes") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def run_job(job, root, logs, env, signature):
    key, cache, script, flags = job
    started = time.monotonic()
    names = outputs_for(job)
    before = {name: (root / name).read_bytes() if (root / name).exists() else None for name in names}
    log = logs / (key + ".log")
    stats = logs / (key + "-api.json")
    stats.unlink(missing_ok=True)
    failure = None
    print("Refreshing " + key, flush=True)
    try:
        with log.open("w") as output:
            result = subprocess.run([sys.executable, str(root / "work" / script), *flags],
                cwd=root, env={**env, "MARKET_API_STATS": str(stats),
                              "MARKET_REPORT_REFRESH": "1" if key in ("fund_reports", "northbound") else "0"},
                stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"Process exited {result.returncode}")
        for name in names:
            # JSON rejects neither NaN nor Infinity by default; published data must.
            value = json.loads((root / name).read_text(),
                               parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON: " + value)))
            if not isinstance(value, dict) or not value:
                raise ValueError("Missing dataset object: " + name)
            if value.get("failures") or value.get("meta", {}).get("missingBondDates"):
                raise ValueError("Unresolved source fetch failures: " + name)
            if before[name]:
                validate_history(json.loads(before[name]), value, env["MARKET_END_DATE"])
    except Exception as error:
        failure = str(error)
        for name, content in before.items():
            restore(root / name, content)
    requests = None
    if stats.exists():
        try:
            requests = json.loads(stats.read_text()).get("requests")
        except (ValueError, OSError):
            pass
    record = {"status": "ok" if failure is None else "failed_cached" if before[names[0]] is not None else "failed",
              "seconds": round(time.monotonic() - started, 2), "requests": requests,
              "log": str(log.relative_to(root)), "command": [script, *flags], "codeSignature": signature,
              "outputs": fingerprints(root, names)}
    if failure:
        record["error"] = failure
        record["restoredPreviousOutputs"] = True
        print((log.read_text() if log.exists() else failure)[-1800:], flush=True)
    print(key + ": " + json.dumps({k: v for k, v in record.items() if k not in ("outputs", "codeSignature")}), flush=True)
    return key, record
