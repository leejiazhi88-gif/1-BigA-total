"""Align weekly period labels to the exchange calendar, without changing amounts."""
from datetime import datetime


def week_key(date):
    return datetime.strptime(date.replace("-", ""), "%Y%m%d").isocalendar()[:2]


def calendar_week_ends(token, request, rows, end_date):
    ends = {}
    if not rows:
        return ends
    first_year = min(int(row["date"][:4]) for row in rows)
    for year in range(first_year, int(end_date[:4]) + 1):
        days = request(token, "trade_cal", {
            "exchange": "SSE", "start_date": f"{year}0101",
            "end_date": min(f"{year}1231", end_date), "is_open": "1",
        }, "cal_date,is_open")
        if not days:
            raise RuntimeError(f"No trading calendar returned for {year}")
        for row in days:
            date = row["cal_date"]
            if date <= end_date and str(row.get("is_open", 1)) == "1":
                key = week_key(date)
                ends[key] = max(ends.get(key, ""), date)
    return ends


def align_rows(rows, ends):
    result = []
    for row in rows:
        target = ends.get(week_key(row["date"]))
        item = dict(row)
        if target:
            date = f"{target[:4]}-{target[4:6]}-{target[6:]}"
            if date != item["date"]:
                item.setdefault("sourcePeriodLabel", item["date"])
            item["date"] = date
        result.append(item)
    return sorted(result, key=lambda row: row["date"])
