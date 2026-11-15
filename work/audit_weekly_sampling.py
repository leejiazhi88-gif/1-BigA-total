"""Audit weekly labels against exchange sessions without treating every non-Friday as an error."""
import json
import re
from collections import Counter
from pathlib import Path
from fetch_large_money_sentiment_data import get_token, call_api
from weekly_dates import calendar_week_ends, week_key

ROOT = Path(__file__).resolve().parents[1]


def main():
    groups = {}
    def walk(value, prefix):
        if isinstance(value, list):
            rows = [row for row in value if isinstance(row, dict) and isinstance(row.get("date"), str)]
            if rows:
                groups[prefix] = rows
        elif isinstance(value, dict):
            for key, item in value.items():
                if key != "meta":
                    walk(item, prefix + "." + key)
    for name in ("retail_sentiment_data", "retail_weekly_averages", "retail_index_metrics",
                 "large_money_sentiment_data", "large_money_index_data", "large_money_etf_shares", "valuation_data"):
        file = ROOT / "work" / (name + ".json")
        if file.exists():
            walk(json.loads(file.read_text(encoding="utf-8")), name)
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    match = re.search(r"^const DATA = (.+);$", html, re.M)
    overview = json.loads(match.group(1))
    for key in ("sh", "sz", "k50", "overviewPe", "officialOverviewPe"):
        if key in overview:
            walk(overview[key], "overview." + key)
    all_rows = [row for rows in groups.values() for row in rows]
    cutoff = max(row["date"] for row in all_rows).replace("-", "")
    ends = calendar_week_ends(get_token(), call_api, all_rows, cutoff)
    summary = {}
    for name, rows in groups.items():
        different = []
        no_sessions = []
        for row in rows:
            expected = ends.get(week_key(row["date"]))
            if not expected:
                no_sessions.append(row["date"])
            elif row["date"].replace("-", "") != expected:
                different.append({"observedDate": row["date"], "calendarWeekEnd": expected})
        summary[name] = {"points": len(rows), "lastDate": rows[-1]["date"],
                         "weekdayCounts": dict(Counter(__import__("datetime").datetime.strptime(row["date"], "%Y-%m-%d").strftime("%a") for row in rows)),
                         "nonWeekEndObservationCount": len(different), "nonWeekEndExamples": different[:12],
                         "noSessionWeekLabels": no_sessions}
    report = {"cutoff": cutoff, "rule": "Natural ISO week, last actual exchange trading day. Weekly means/sums keep their numerical definition. Earlier source observations and weeks without trading sessions remain explicit exceptions; no artificial Friday observations.",
              "series": summary}
    output = ROOT / "outputs" / "weekly_sampling_audit.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, value in summary.items():
        print(name, value["points"], value["weekdayCounts"], "earlier observations", value["nonWeekEndObservationCount"],
              "closed weeks", len(value["noSessionWeekLabels"]), flush=True)


if __name__ == "__main__":
    main()
