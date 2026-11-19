"""GitHub runner calendar gate, freshness report and scoped publication helpers."""
import argparse
import json
import os
import subprocess
import time
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from refresh_cache import write_json
from refresh_dashboard import task_catalog
from refresh_jobs import outputs_for
from tushare_client import call_api


ROOT = Path(__file__).resolve().parents[1]
SHANGHAI = ZoneInfo("Asia/Shanghai")
CALENDAR = ROOT / ".tools/cloud-calendar.json"
REPORT = ROOT / "outputs/cloud-refresh-latest.json"
MARKDOWN = ROOT / "outputs/cloud-refresh-latest.md"


def trading_day(now, token, api=call_api):
    date = now.astimezone(SHANGHAI).strftime("%Y%m%d")
    result = {"date": date, "iso_date": datetime.strptime(date, "%Y%m%d").date().isoformat(),
              "startedAt": now.astimezone(SHANGHAI).isoformat(), "is_open": False, "calendars": {}}
    if now.astimezone(SHANGHAI).weekday() >= 5:
        return {**result, "reason": "weekend"}
    if not token:
        raise ValueError("Add the repository Actions secret TUSHARE_TOKEN before running the online refresh")
    for exchange in ("SSE", "SZSE"):
        rows = api(token, "trade_cal", {"exchange": exchange, "start_date": date, "end_date": date},
                   "exchange,cal_date,is_open")
        if (len(rows) != 1 or rows[0].get("cal_date") != date
                or rows[0].get("exchange") != exchange
                or str(rows[0].get("is_open")) not in ("0", "1")):
            raise ValueError("Missing or invalid trading calendar: " + exchange + " " + date)
        result["calendars"][exchange] = str(rows[0]["is_open"]) == "1"
    if len(set(result["calendars"].values())) != 1:
        raise ValueError("Shanghai/Shenzhen calendar disagreement; refusing to guess")
    return {**result, "is_open": result["calendars"]["SSE"],
            "reason": "trading_day" if result["calendars"]["SSE"] else "exchange_holiday"}


def output(values):
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as handle:
            for key, value in values.items():
                handle.write(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n")


def summary(text):
    print(text, flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def current_report(report, calendar):
    if report.get("requestedEnd") != calendar["date"]:
        return False
    try:
        generated = datetime.fromisoformat(report["generatedAt"])
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=SHANGHAI)
        return generated >= datetime.fromisoformat(calendar["startedAt"])
    except (KeyError, TypeError, ValueError):
        return False


def freshness(report, date):
    rows = report.get("inventory", {}).get("rows", [])
    # Count checklist metrics, not API requests, funds, stocks or monthly reports.
    daily = [row for row in rows if row.get("frequency") in ("daily", "weekly")]
    present = [row for row in daily if str(row.get("latest") or "").replace("-", "") == date
               and row.get("status") not in ("failed", "unavailable", "low_coverage", "pending")]
    return {"observedOnTargetDate": len(present), "dailyWeeklyMetrics": len(daily),
            "percent": round(100 * len(present) / len(daily), 2) if daily else None,
            "statusCounts": dict(Counter(row.get("status", "unknown") for row in rows)),
            "notCurrent": [row for row in daily if row not in present]}


def allowed_outputs():
    jobs, _ = task_catalog()
    paths = {name for job in jobs for name in outputs_for(job)}
    return sorted(paths | {"index.html", "outputs/refresh-latest.json", "outputs/refresh-latest.md",
                           "outputs/block-trade-audit.json", "outputs/cloud-refresh-latest.json",
                           "outputs/cloud-refresh-latest.md"})


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def commit():
    calendar = json.loads(CALENDAR.read_text())
    report = json.loads((ROOT / "outputs/refresh-latest.json").read_text())
    cloud = json.loads(REPORT.read_text())
    if (not calendar["is_open"] or not current_report(report, calendar)
            or not report.get("publishReady") or report.get("blockingIssues")
            or not cloud.get("buildSucceeded") or cloud.get("date") != calendar["date"]):
        raise ValueError("Refusing to commit a failed, skipped or stale refresh")
    changed = set(filter(None, git("diff", "--name-only", "HEAD").splitlines()))
    unexpected = changed - set(allowed_outputs())
    if unexpected:
        raise ValueError("Refresh changed files outside its outputs: " + ", ".join(sorted(unexpected)))
    # Checkouts are ephemeral; never rebase/force over a concurrent human update.
    git("fetch", "origin", "main", "--depth=1")
    if git("rev-parse", "HEAD") != git("rev-parse", "origin/main"):
        raise ValueError("Remote main changed during refresh; retaining the published page")
    paths = [name for name in allowed_outputs() if (ROOT / name).is_file()]
    git("add", "--", *paths)
    if not git("diff", "--cached", "--name-only"):
        output({"changed": False})
        return
    git("-c", "user.name=github-actions[bot]", "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit", "-m", "Refresh A-Total through " + calendar["iso_date"])
    git("push", "origin", "HEAD:main")
    output({"changed": True})
    summary("Data commit: `" + git("rev-parse", "HEAD") + "`; Pages deployment follows.")


def record_report():
    calendar = json.loads(CALENDAR.read_text())
    path = ROOT / "outputs/refresh-latest.json"
    report = json.loads(path.read_text()) if path.exists() else {}
    current = current_report(report, calendar)
    built = os.environ.get("BUILD_OUTCOME") == "success"
    result = {"date": calendar["date"], "startedAt": calendar["startedAt"],
              "runUrl": "https://github.com/" + os.environ.get("GITHUB_REPOSITORY", "leejiazhi88-gif/1-BigA-total")
                        + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", ""),
              "freshReport": current, "buildSucceeded": built,
              "publishReady": bool(current and built and report.get("publishReady")
                                   and not report.get("blockingIssues")),
              "availability": freshness(report, calendar["date"]) if current else None,
              "blockingIssues": report.get("blockingIssues", []) if current else ["No fresh refresh report from this run"]}
    write_json(REPORT, result)
    lines = ["# A-Total 云端刷新", "", "目标交易日：" + calendar["iso_date"],
             "", "北京时间开始：" + calendar["startedAt"], "", "运行记录：" + result["runUrl"],
             "", "构建与发布前验收：" + ("通过；等待提交与Pages部署结果" if result["publishReady"] else "未通过；不发布"), ""]
    if current:
        availability = result["availability"]
        lines += [f'日／周频清单项目观测到目标日：{availability["observedOnTargetDate"]} / '
                  f'{availability["dailyWeeklyMetrics"]}（{availability["percent"]}%）。',
                  "", "这是按清单指标计数的日期覆盖率，不是全页完整率或接口成功率；月报、季报和已停止披露的历史序列不计入。不会自动调整16:30时间。", "",
                  "完整状态与真实观测／来源核验日期见 [逐项报告](refresh-latest.md)。未公布数据不补零、不冒充当日，下一交易日普通刷新复查近期区间。", "",
                  "| 未到目标日的日／周频项目 | 最后观测 | 状态 |", "| --- | --- | --- |"]
        for row in availability["notCurrent"]:
            lines.append("| " + " | ".join(str(row.get(key) or "—").replace("|", "／")
                                          for key in ("label", "latest", "statusLabel")) + " |")
    if result["blockingIssues"]:
        lines += ["", "阻断：", ""] + ["- " + str(issue) for issue in result["blockingIssues"]]
    text = "\n".join(lines) + "\n"
    MARKDOWN.parent.mkdir(parents=True, exist_ok=True)
    MARKDOWN.write_text(text, encoding="utf-8")
    summary(text)


def verify_live():
    base = os.environ["PAGE_URL"].rstrip("/") + "/"
    revision = git("rev-parse", "HEAD")
    expected = (ROOT / "index.html").read_bytes()
    for attempt in range(12):
        try:
            def fetch(name):
                request = urllib.request.Request(base + name + "?v=" + revision,
                                                 headers={"Cache-Control": "no-cache"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    return response.read()
            if fetch("deployment-version.txt").decode().strip() == revision and fetch("") == expected:
                summary("Published and verified: " + base + "?v=" + revision[:7])
                return
        except (OSError, ValueError) as error:
            print("Pages verification retry:", type(error).__name__, flush=True)
        if attempt < 11:
            time.sleep(10)
    raise RuntimeError("Pages deployment returned, but the published revision/page could not be verified")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["calendar", "report", "commit", "verify-live"])
    args = parser.parse_args()
    if args.command == "calendar":
        result = trading_day(datetime.now(SHANGHAI), os.environ.get("TUSHARE_TOKEN"))
        write_json(CALENDAR, result)
        output({key: result[key] for key in ("date", "iso_date", "is_open")})
        summary("Trading-day check: " + result["iso_date"] + " / " + result["reason"]
                + ("; refresh will run once." if result["is_open"] else "; no data refresh or deployment."))
    elif args.command == "report":
        record_report()
    elif args.command == "commit":
        commit()
    else:
        verify_live()


if __name__ == "__main__":
    main()
