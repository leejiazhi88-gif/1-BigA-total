import json
import math
import re
import time
from datetime import datetime
from pathlib import Path

from tushare_client import END_DATE, call_api, get_token


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "work" / "national_team_etf_data.json"
refresh_year = int(END_DATE[:4])
refresh_month_day = END_DATE[4:]
PERIOD = (f"{refresh_year}0930" if refresh_month_day >= "1101" else
          f"{refresh_year}0630" if refresh_month_day >= "0901" else
          f"{refresh_year}0331" if refresh_month_day >= "0501" else
          f"{refresh_year - 1}0930")
HISTORY_PERIODS = [f"{year}{month_day}" for year in range(2015, refresh_year + 1)
                   for month_day in ("0630", "1231") if f"{year}{month_day}" <= PERIOD]
HISTORY_PERIODS = sorted(set(HISTORY_PERIODS + [PERIOD]))

ETF_POOL = [
    {"ts_code": "510050.SH", "name": "华夏上证50ETF", "group": "宽基大盘"},
    {"ts_code": "510300.SH", "name": "华泰柏瑞沪深300ETF", "group": "宽基大盘"},
    {"ts_code": "510500.SH", "name": "南方中证500ETF", "group": "宽基中盘"},
    {"ts_code": "512100.SH", "name": "南方中证1000ETF", "group": "宽基小盘"},
    {"ts_code": "159915.SZ", "name": "易方达创业板ETF", "group": "成长宽基"},
    {"ts_code": "588000.SH", "name": "华夏科创50ETF", "group": "成长宽基"},
    {"ts_code": "510880.SH", "name": "华泰柏瑞上证红利ETF", "group": "红利低波"},
    {"ts_code": "512800.SH", "name": "华宝中证银行ETF", "group": "金融行业"},
    {"ts_code": "512000.SH", "name": "华宝中证全指证券ETF", "group": "金融行业"},
    {"ts_code": "512760.SH", "name": "国泰中证全指半导体ETF", "group": "科技制造"},
    {"ts_code": "159995.SZ", "name": "华夏国证半导体芯片ETF", "group": "科技制造"},
    {"ts_code": "515790.SH", "name": "华泰柏瑞中证光伏产业ETF", "group": "科技制造"},
]

HISTORY_ETFS = ["510050.SH", "510300.SH"]

CRISIS_MARKS = [
    {"date": "2015-06-30", "name": "2015股灾"},
    {"date": "2018-09-30", "name": "2018调整"},
    {"date": "2020-03-31", "name": "2020冲击"},
    {"date": "2024-02-29", "name": "2024低点"},
]

NATIONAL_TEAM_PATTERNS = [
    "中央汇金投资有限责任公司",
    "中央汇金资产管理有限责任公司",
    "中国证券金融股份有限公司",
    "中国证金",
    "证金公司",
    "汇金资产",
]



def is_national_team(holder_name):
    name = holder_name or ""
    return any(pattern in name for pattern in NATIONAL_TEAM_PATTERNS)


def normalized_holdings(rows):
    usable = []
    total_mkv = 0.0
    for row in rows:
        symbol = row.get("symbol")
        if not symbol or not re.search(r"\.(SH|SZ)$", symbol):
            continue
        mkv = float(row.get("mkv") or 0)
        ratio = float(row.get("stk_mkv_ratio") or 0)
        if mkv <= 0 and ratio <= 0:
            continue
        usable.append({"symbol": symbol, "mkv": mkv, "rawWeight": ratio})
        total_mkv += mkv
    raw_sum = sum(row["rawWeight"] for row in usable)
    for row in usable:
        if raw_sum > 0:
            row["weight"] = row["rawWeight"] / 100
        elif total_mkv > 0:
            row["weight"] = row["mkv"] / total_mkv
        else:
            row["weight"] = 0
    return usable


def disclosed_rows(rows, period):
    rows = [row for row in rows if row.get("end_date") == period
            and row.get("ann_date") and row["ann_date"] <= END_DATE]
    if not rows:
        return []
    latest = max(row["ann_date"] for row in rows)
    return [row for row in rows if row["ann_date"] == latest]


def portfolio(token, code, period):
    rows = call_api(token, "fund_portfolio", {"ts_code": code, "period": period},
                    "ts_code,ann_date,end_date,symbol,mkv,amount,stk_mkv_ratio,stk_float_ratio")
    return normalized_holdings(disclosed_rows(rows, period))


def holder_snapshot(token, period):
    grouped = {}
    offset, previous_page = 0, None
    while True:
        rows = call_api(token, "top10_floatholders", {"period": period, "limit": 6000, "offset": offset},
                        "ts_code,ann_date,end_date,holder_name,hold_amount,hold_ratio,hold_float_ratio,holder_type")
        signature = json.dumps(rows, sort_keys=True)
        if rows and signature == previous_page:
            raise RuntimeError("Holder pagination repeated a page; aborting incomplete refresh.")
        previous_page = signature
        for row in rows:
            grouped.setdefault(row["ts_code"], []).append(row)
        if len(rows) < 6000:
            break
        offset += len(rows)
        time.sleep(0.25)
    exposure, details = {}, {}
    for symbol, rows in grouped.items():
        holders = disclosed_rows(rows, period)
        if not holders:
            continue
        matched = {row["holder_name"]: row for row in holders if is_national_team(row.get("holder_name"))}
        if any(row.get("hold_float_ratio") is None for row in matched.values()):
            continue
        exposure[symbol] = sum(float(row["hold_float_ratio"]) for row in matched.values()) / 100
        details[symbol] = [{"holderName": row["holder_name"], "holdFloatRatio": row["hold_float_ratio"]}
                           for row in matched.values()]
    return exposure, details


def history_point(period, snapshots, holder_exposure):
    point = {"date": f"{period[:4]}-{period[4:6]}-{period[6:]}", "coverage": {}, "disclosedWeight": {}}
    for code, holdings in snapshots.items():
        known = [row for row in holdings if row["symbol"] in holder_exposure]
        coverage = sum(row["weight"] for row in known) * 100
        point["coverage"][code] = round(coverage, 2)
        point["disclosedWeight"][code] = round(sum(row["weight"] for row in holdings) * 100, 2)
        point[code] = round(sum(row["weight"] * holder_exposure[row["symbol"]] for row in known) * 100, 4) if known else None
    values = [point[code] for code in snapshots if point[code] is not None]
    point["averageExposure"] = round(sum(values) / len(values), 4) if len(values) == len(snapshots) else None
    point["activeCount"] = len(values)
    return point


def cosine(a, b):
    keys = set(a) | set(b)
    dot = sum(a.get(key, 0) * b.get(key, 0) for key in keys)
    norm_a = math.sqrt(sum(value * value for value in a.values()))
    norm_b = math.sqrt(sum(value * value for value in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def cluster_etfs(items, target_count=6):
    clusters = [[idx] for idx in range(len(items))]
    vectors = [{row["symbol"]: row["weight"] for row in item["holdings"]} for item in items]

    def similarity(left, right):
        scores = [cosine(vectors[i], vectors[j]) for i in left for j in right]
        return sum(scores) / len(scores) if scores else 0

    while len(clusters) > target_count:
        best = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                score = similarity(clusters[i], clusters[j])
                if best is None or score > best[0]:
                    best = (score, i, j)
        _, i, j = best
        clusters[i] = clusters[i] + clusters[j]
        clusters.pop(j)

    labels = {}
    for number, cluster in enumerate(clusters, 1):
        avg_exposure = sum(items[idx]["nationalTeamExposure"] for idx in cluster) / len(cluster)
        top_group = {}
        for idx in cluster:
            top_group[items[idx]["group"]] = top_group.get(items[idx]["group"], 0) + 1
        groups = set(top_group)
        if "金融行业" in groups and "成长宽基" in groups:
            label = "大盘成长混合"
        elif "金融行业" in groups and "宽基大盘" in groups:
            label = "大盘金融"
        elif "科技制造" in groups:
            label = "科技制造"
        elif "成长宽基" in groups:
            label = "成长宽基"
        elif "红利低波" in groups:
            label = "红利低波"
        else:
            label = max(top_group, key=top_group.get)
        for idx in cluster:
            labels[items[idx]["ts_code"]] = {
                "cluster": number,
                "clusterName": f"{label}类",
                "clusterAverageExposure": round(avg_exposure, 4),
            }
    return labels


def main():
    token = get_token()
    etfs = []
    symbols = set()

    for etf in ETF_POOL:
        holdings = portfolio(token, etf["ts_code"], PERIOD)
        if not holdings:
            raise RuntimeError(f"No disclosed holdings for {etf['ts_code']} in {PERIOD}; retaining previous dataset.")
        symbols.update(row["symbol"] for row in holdings)
        etfs.append({**etf, "holdings": holdings, "rawRows": len(holdings)})

    history = []
    for period in HISTORY_PERIODS:
        period_exposure, period_details = holder_snapshot(token, period)
        if period == PERIOD:
            snapshots = {row["ts_code"]: row["holdings"] for row in etfs if row["ts_code"] in HISTORY_ETFS}
            holder_exposure, holder_details = period_exposure, period_details
        else:
            snapshots = {code: portfolio(token, code, period) for code in HISTORY_ETFS}
        history.append(history_point(period, snapshots, period_exposure))
        print(f"Disclosed history {period}: {history[-1]['activeCount']} ETFs, {len(period_exposure)} stock holder observations", flush=True)

    for etf in etfs:
        exposure = sum(row["weight"] * holder_exposure.get(row["symbol"], 0) for row in etf["holdings"])
        coverage = sum(row["weight"] for row in etf["holdings"] if row["symbol"] in holder_exposure)
        top_national = sorted(
            [
                {
                    "symbol": row["symbol"],
                    "weight": round(row["weight"] * 100, 4),
                    "nationalTeamFloatRatio": round(holder_exposure.get(row["symbol"], 0) * 100, 4),
                    "contribution": round(row["weight"] * holder_exposure.get(row["symbol"], 0) * 100, 4),
                    "holders": holder_details.get(row["symbol"], []),
                }
                for row in etf["holdings"]
                if holder_exposure.get(row["symbol"], 0) > 0
            ],
            key=lambda row: row["contribution"],
            reverse=True,
        )[:5]
        etf["nationalTeamExposure"] = round(exposure * 100, 4) if coverage > 0 else None
        etf["coverageWeight"] = round(coverage * 100, 2)
        etf["disclosedWeight"] = round(sum(row["weight"] for row in etf["holdings"]) * 100, 2)
        etf["holdingCount"] = len(etf["holdings"])
        etf["topNationalTeamContributors"] = top_national
        etf["holdings"] = [
            {
                "symbol": row["symbol"],
                "weight": round(row["weight"] * 100, 4),
                "nationalTeamFloatRatio": round(holder_exposure[row["symbol"]] * 100, 4) if row["symbol"] in holder_exposure else None,
            }
            for row in sorted(etf["holdings"], key=lambda item: item["weight"], reverse=True)
        ]

    if any(row["nationalTeamExposure"] is None for row in etfs):
        raise RuntimeError("Latest ETF snapshot has no usable stock holder coverage; retaining previous dataset.")
    cluster_labels = cluster_etfs(etfs)
    for etf in etfs:
        etf.update(cluster_labels[etf["ts_code"]])

    clusters = []
    for cluster in sorted(set(row["cluster"] for row in etfs)):
        members = [row for row in etfs if row["cluster"] == cluster]
        clusters.append(
            {
                "cluster": cluster,
                "clusterName": members[0]["clusterName"],
                "count": len(members),
                "averageExposure": round(
                    sum(row["nationalTeamExposure"] for row in members) / len(members), 4
                ),
                "members": [row["ts_code"] for row in members],
            }
        )

    result = {
        "meta": {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "requestedEnd": END_DATE,
            "methodVersion": 2,
            "period": PERIOD,
            "historyPeriods": HISTORY_PERIODS,
            "crisisMarks": CRISIS_MARKS,
            "source": "Tushare fund_portfolio + top10_floatholders",
            "method": "Sum of disclosed stock weights / 100 * identified national-team float-holder ratios",
            "historyScope": "All disclosed A-share stocks of 510050.SH and 510300.SH; semiannual reporting periods since 2015",
            "directEtfHolding": False,
            "limitations": [
                "fund_portfolio may be disclosed holdings rather than full index constituents",
                "top10_floatholders only captures national-team accounts disclosed in top ten float holders",
                "ratio is bottom-up stock exposure, not direct ETF unit ownership",
                "Unidentified stock holder coverage is excluded; observations are disclosed lower bounds",
                "Semiannual snapshots are not daily holdings or evidence of purchases between reports",
                "State ownership includes long-standing holdings, not only market-stabilization purchases",
            ],
        },
        "history": history,
        "etfs": sorted(etfs, key=lambda row: row["nationalTeamExposure"], reverse=True),
        "clusters": clusters,
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "etfs": len(etfs), "symbols": len(symbols)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
