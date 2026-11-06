"""Daily incremental refresh, with separately scheduled disclosure datasets."""
import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

from refresh_cache import write_json
from tushare_client import END_DATE

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".tools" / "refresh-state.json"
LOGS = ROOT / ".tools" / "refresh-logs"


def due(path, state, key, days, end, force=False):
    if force or not path.exists():
        return True
    data = json.loads(path.read_text())
    meta = data.get("meta", {})
    checked = state.get(key, {}).get("checkedAt") or meta.get("checkedAt") or meta.get("updated")
    if not checked:
        return True
    checked_date = datetime.strptime(checked[:10], "%Y-%m-%d")
    target = datetime.strptime(end, "%Y%m%d")
    previous_end = state.get(key, {}).get("requestedEnd") or meta.get("requestedEnd") or meta.get("end")
    if previous_end and previous_end.replace("-", "")[:6] != end[:6]:
        return True
    # A new month/report window must not wait for the normal cooldown.
    return target.strftime("%Y%m") != checked_date.strftime("%Y%m") or target - checked_date >= timedelta(days=days)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full-refresh", action="store_true")
    parser.add_argument("--reports", action="store_true")
    args = parser.parse_args()
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    jobs = []
    skipped = []
    slow = [("fund_reports", "large_money_fund_reports.json", "fetch_large_money_fund_metrics.py", ["--only", "reports"], 7),
            ("northbound", "northbound_holdings.json", "fetch_northbound_holdings.py", [], 7),
            ("national_team", "national_team_etf_data.json", "fetch_national_team_etf_data.py", [], 7),
            ("monthly", "retail_monthly_trends.json", "fetch_retail_monthly_trends.py", [], 1),
            ("refinancing", "refinancing_data.json", "fetch_refinancing_data.py", [], 1)]
    for key, cache, script, flags, days in slow:
        if due(ROOT / "work" / cache, state, key, days, END_DATE, args.full_refresh or args.reports):
            if args.full_refresh and key == "fund_reports":
                flags += ["--full-history"]
            jobs.append((key, cache, script, flags))
        else:
            skipped.append(key)
    # Daily sources never skip on a same-day retry: late releases can arrive.
    for name in ("market_overview", "valuation", "retail_sentiment", "large_money_sentiment", "official_sentiment", "etf_flow"):
        jobs.append((name, name + "_data.json", "fetch_" + name + "_data.py", []))
    jobs.append(("etf_shares", "large_money_etf_shares.json", "fetch_large_money_fund_metrics.py", ["--only", "etfs"]))
    # Start the longest daily jobs early so they do not become a serial tail.
    priority = {key: index for index, key in enumerate(
        ("etf_shares", "large_money_sentiment", "official_sentiment", "monthly"))}
    jobs.sort(key=lambda job: priority.get(job[0], len(priority)))
    LOGS.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    env = {**os.environ, "MARKET_END_DATE": END_DATE, "PYTHONUNBUFFERED": "1"}
    if args.full_refresh:
        env["MARKET_FULL_REFRESH"] = "1"
    if Path("/etc/ssl/cert.pem").exists():
        env.setdefault("SSL_CERT_FILE", "/etc/ssl/cert.pem")

    def run(job):
        key, cache, script, flags = job
        before = time.monotonic()
        log = LOGS / (key + ".log")
        stats = LOGS / (key + "-api.json")
        if stats.exists():
            stats.unlink()
        print("Refreshing " + key, flush=True)
        with log.open("w") as output:
            result = subprocess.run([sys.executable, str(ROOT / "work" / script), *flags],
                cwd=ROOT, env={**env, "MARKET_API_STATS": str(stats),
                              "MARKET_REPORT_REFRESH": "1" if key in ("fund_reports", "northbound") else "0"},
                stdout=output, stderr=subprocess.STDOUT)
        requests = json.loads(stats.read_text())["requests"] if stats.exists() else None
        record = {"status": "ok" if result.returncode == 0 else "failed_cached" if (ROOT / "work" / cache).exists() else "failed",
                  "seconds": round(time.monotonic() - before, 2), "requests": requests, "log": str(log.relative_to(ROOT))}
        print(key + ": " + json.dumps(record), flush=True)
        if result.returncode:
            print(log.read_text()[-2500:], flush=True)
        return key, record

    results = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in as_completed([pool.submit(run, job) for job in jobs]):
            key, record = future.result()
            results[key] = record
            if record["status"] == "ok":
                state[key] = {"checkedAt": datetime.now().isoformat(), "requestedEnd": END_DATE}
    report = {"requestedEnd": END_DATE, "mode": "full" if args.full_refresh else "incremental",
              "seconds": round(time.monotonic() - started, 2), "skippedDisclosures": skipped, "jobs": results}
    write_json(STATE, state)
    write_json(LOGS / "latest.json", report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if any(r["status"] == "failed" for r in results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
