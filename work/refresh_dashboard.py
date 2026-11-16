"""Daily incremental refresh, with separately scheduled disclosure datasets."""
import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

from refresh_cache import write_json
from tushare_client import END_DATE
from refresh_jobs import SUCCESS, code_signature, refresh_lock, reusable, run_job

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".tools" / "refresh-state.json"
LOGS = ROOT / ".tools" / "refresh-logs"


def due(path, state, key, days, end, force=False):
    if force or not path.exists():
        return True
    try:
        data = json.loads(path.read_text())
        meta = data.get("meta", {})
        checked = state.get(key, {}).get("checkedAt") or meta.get("checkedAt") or meta.get("updated")
        checked_date = datetime.strptime(checked[:10], "%Y-%m-%d")
    except (ValueError, TypeError, AttributeError):
        return True
    if not checked:
        return True
    target = datetime.strptime(end, "%Y%m%d")
    previous_end = state.get(key, {}).get("requestedEnd") or meta.get("requestedEnd") or meta.get("end")
    if previous_end and previous_end.replace("-", "")[:6] != end[:6]:
        return True
    # A new month/report window must not wait for the normal cooldown.
    return target.strftime("%Y%m") != checked_date.strftime("%Y%m") or target - checked_date >= timedelta(days=days)


def task_catalog(full=False):
    slow = [("fund_reports", "large_money_fund_reports.json", "fetch_large_money_fund_metrics.py", ["--only", "reports"], 7),
            ("fund_report_audit", "active_fund_report_audit.json", "audit_active_fund_latest.py", [], 1),
            ("northbound", "northbound_holdings.json", "fetch_northbound_holdings.py", [], 7),
            ("national_team", "national_team_etf_data.json", "fetch_national_team_etf_data.py", [], 7),
            ("monthly", "retail_monthly_trends.json", "fetch_retail_monthly_trends.py", [], 1),
            ("refinancing", "refinancing_data.json", "fetch_refinancing_data.py", [], 1)]
    if full:
        slow[0][3].append("--full-history")
    jobs = [row[:4] for row in slow]
    jobs += [(name, name + "_data.json", "fetch_" + name + "_data.py", []) for name in
             ("market_overview", "valuation", "retail_sentiment", "large_money_sentiment", "official_sentiment", "etf_flow")]
    jobs.append(("etf_shares", "large_money_etf_shares.json", "fetch_large_money_fund_metrics.py", ["--only", "etfs"]))
    return jobs, {row[0]: row[4] for row in slow}


def write_report(report):
    write_json(LOGS / ("audit-latest.json" if report["mode"] == "audit_only" else "latest.json"), report)
    write_json(ROOT / "outputs" / "refresh-latest.json", report)
    labels = {"ok": "已取数", "reused_success": "复用同次成功结果", "cached_not_due": "仅验缓存／未访问来源" if report["mode"] == "audit_only" else "缓存／未到复查周期",
              "failed_cached": "失败／已还原旧数据", "failed_validation": "取数完成但数据验收失败", "failed": "失败"}
    lines = ["# A-Total 数据更新验收", "", "查询截止：" + report["requestedEnd"],
             "", "运行方式：" + report["mode"] + "；总耗时：" + str(report["seconds"]) + "秒（不含页面构建和线上发布）",
             "", "发布检查：" + ("通过" if report["publishReady"] else "未通过，禁止将缓存沿用视为更新成功"),
             "", "| 任务 | 结果 | 秒 | 请求数 |", "| --- | --- | ---: | ---: |"]
    for key, row in report["jobs"].items():
        lines.append(f'| {key} | {labels.get(row["status"], row["status"])} | {row.get("seconds", "—")} | {row.get("requests", "—")} |')
    lines += ["", "## 全页数据清单", "", "`checkedAt`是源数据核验日期，不是本报告生成日期。未到复查周期不代表今天重新访问了来源。", "",
              "| 指标 | 最新观测／报告期 | 来源核验日期 | 状态 | 说明 |", "| --- | --- | --- | --- | --- |"]
    for row in report.get("inventory", {}).get("rows", []):
        clean = lambda value: str(value or "—").replace("|", "／").replace("\n", " ")
        display = {**row, "status": row.get("statusLabel", row["status"])}
        lines.append("| " + " | ".join(clean(display.get(key)) for key in ("label", "latest", "checkedAt", "status", "reason")) + " |")
    lines += ["", "## 阻断项", ""] + ["- " + str(item) for item in report["blockingIssues"]]
    target = ROOT / "outputs" / "refresh-latest.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def refresh(args):
    from refresh_inventory import audit_inventory
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    original_state = dict(state)
    signature = code_signature(ROOT)
    previous = json.loads((LOGS / "latest.json").read_text()) if (LOGS / "latest.json").exists() else {}
    if args.retry_failed and previous.get("requestedEnd") != END_DATE:
        raise ValueError("--retry-failed requires the same MARKET_END_DATE as the last run")
    full_refresh = args.full_refresh or (args.retry_failed and previous.get("fullRefresh", False))
    all_jobs, periods = task_catalog(full_refresh)
    jobs, skipped, results = [], [], {}
    for job in all_jobs:
        key, cache, _, _ = job
        last = previous.get("jobs", {}).get(key, {})
        if args.retry_failed and reusable(last, job, ROOT, signature):
            results[key] = {**last, "status": "reused_success", "seconds": 0, "requests": 0}
        elif args.audit_only or (key in periods and not due(ROOT / "work" / cache, state, key, periods[key], END_DATE,
                args.full_refresh or args.reports or (args.retry_failed and last.get("status") in ("failed", "failed_cached", "failed_validation")))):
            skipped.append(key)
            results[key] = {"status": "cached_not_due", "checkedAt": state.get(key, {}).get("checkedAt"),
                            "reason": "audit_only" if args.audit_only else "within_disclosure_cooldown"}
        else:
            jobs.append(job)
    priority = {key: index for index, key in enumerate(("etf_shares", "large_money_sentiment", "official_sentiment", "monthly"))}
    jobs.sort(key=lambda job: priority.get(job[0], len(priority)))
    LOGS.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    env = {**os.environ, "MARKET_END_DATE": END_DATE, "PYTHONUNBUFFERED": "1"}
    if full_refresh:
        env["MARKET_FULL_REFRESH"] = "1"
    if Path("/etc/ssl/cert.pem").exists():
        env.setdefault("SSL_CERT_FILE", "/etc/ssl/cert.pem")
    # Audit may reuse today's report responses only after the report refresh completes.
    audit_jobs = [job for job in jobs if job[0] == "fund_report_audit"]
    jobs = [job for job in jobs if job[0] != "fund_report_audit"]
    for batch in (jobs, audit_jobs):
        with ThreadPoolExecutor(max_workers=3) as pool:
            for future in as_completed([pool.submit(run_job, job, ROOT, LOGS, env, signature) for job in batch]):
                key, record = future.result()
                results[key] = record
                if record["status"] in SUCCESS:
                    record["checkedAt"] = datetime.now().isoformat()
                    state[key] = {"checkedAt": record["checkedAt"], "requestedEnd": END_DATE}
    try:
        inventory = audit_inventory(ROOT, END_DATE, job_results=results, state=state)
    except Exception as error:
        inventory = {"rows": [], "blockingIssues": ["Inventory audit failed: " + str(error)]}
    for row in inventory.get("rows", []):
        key = row.get("job")
        if row.get("status") == "failed" and results.get(key, {}).get("status") in SUCCESS:
            results[key].update(status="failed_validation", error=row["reason"])
            if key in original_state:
                state[key] = original_state[key]
            else:
                state.pop(key, None)
    blocking = [key + ": " + row.get("error", row["status"]) for key, row in results.items()
                if row["status"] in ("failed", "failed_cached", "failed_validation")]
    blocking += inventory["blockingIssues"]
    report = {"requestedEnd": END_DATE, "generatedAt": datetime.now().isoformat(), "fullRefresh": bool(full_refresh),
              "mode": "audit_only" if args.audit_only else "retry_failed" if args.retry_failed
              else "full" if args.full_refresh else "incremental", "seconds": round(time.monotonic() - started, 2),
              "skippedDisclosures": skipped, "jobs": results, "inventory": inventory,
              "blockingIssues": blocking, "publishReady": not blocking}
    if not args.audit_only:
        write_json(STATE, state)
    write_report(report)
    print(json.dumps({"requestedEnd": END_DATE, "seconds": report["seconds"], "publishReady": report["publishReady"],
                      "blockingIssues": blocking, "report": "outputs/refresh-latest.md"}, ensure_ascii=False), flush=True)
    return 0 if report["publishReady"] else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full-refresh", action="store_true")
    parser.add_argument("--reports", action="store_true")
    parser.add_argument("--retry-failed", action="store_true", help="Retry failures at the same cutoff; verify successful outputs before reuse")
    parser.add_argument("--audit-only", action="store_true", help="Inspect all existing datasets without fetching or claiming fresh source checks")
    args = parser.parse_args()
    if args.retry_failed and (args.full_refresh or args.reports or args.audit_only):
        parser.error("--retry-failed cannot be combined with full/report/audit-only modes")
    with refresh_lock(ROOT / ".tools" / "refresh.lock"):
        raise SystemExit(refresh(args))


if __name__ == "__main__":
    main()
