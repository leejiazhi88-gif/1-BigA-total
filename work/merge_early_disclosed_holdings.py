"""Merge audited pre-2015 disclosure samples without filling sparse quarters."""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
BASE = "cf258b48f8ea5c99bb3cd9ea2ffaed88d0422236"
RAW = f"https://raw.githubusercontent.com/leejiazhi88-gif/1-BigA-total/{BASE}/work/"
GAPS = ["20100930", "20110331", "20110930", "20120331", "20120930", "20130331"]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def baseline(name):
    return json.load(urllib.request.urlopen(RAW + name, timeout=60))


def main():
    stock_path = WORK / "national_team_stock_history.json"
    early_stock = read(stock_path)
    h1_stock = read(ROOT / ".tools/early-ccb-reports/stock-20100630.json")
    stock = baseline("national_team_stock_history.json")
    candidates = {p: row for p, row in {**h1_stock["stocks"], **early_stock["stocks"]}.items() if p < "20150000"}
    included = {}
    for period, row in sorted(candidates.items()):
        source = read(ROOT / ".tools/national-team-stock-history" / f"screened-{period}.json")
        social = read(ROOT / ".tools/national-team-stock-history" / f"social-screened-{period}.json")
        if source["source_companies"] < 2000 or social["coverage"]["primary_rows"] < 100:
            if period not in GAPS:
                raise ValueError("Unexpected sparse historical disclosure: " + period)
            continue
        if period in GAPS:
            raise ValueError("Expected sparse historical disclosure: " + period)
        included[period] = row
    stock["stocks"] = {**included, **stock["stocks"]}
    stock["start"] = min(included)
    stock["gaps"] = GAPS
    stock["earlyCoverageRule"] = "Before 2015: at least 2000 Tushare shareholder-list companies and 100 Eastmoney social-security rows; sparse quarters remain null"
    save(stock_path, stock)

    social_path = WORK / "social_security_history.json"
    early_social = read(social_path)
    social = baseline("social_security_history.json")
    prior = {row["period"]: row for row in early_social["snapshots"]}
    prior["20100630"] = read(ROOT / ".tools/national-team-stock-history/social-screened-20100630.json")
    if set(included) - set(prior):
        raise ValueError("Missing early social snapshots")
    social["snapshots"] = [prior[period] for period in included] + social["snapshots"]
    social["snapshots"].sort(key=lambda row: row["period"])
    social["start"] = min(included)
    social["earlyCoverageRule"] = stock["earlyCoverageRule"]
    save(social_path, social)
    print(json.dumps({"earlyPeriods": list(included), "gaps": GAPS,
                      "stockPeriods": len(stock["stocks"]), "socialPeriods": len(social["snapshots"])}))


if __name__ == "__main__":
    main()
