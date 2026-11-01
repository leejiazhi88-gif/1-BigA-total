"""Merge audited pre-2015 company share counts with existing later denominators."""

import json
import urllib.request

from fetch_national_team_stock_history import ROOT, read, save

BASE = "cf258b48f8ea5c99bb3cd9ea2ffaed88d0422236"


def main():
    url = f"https://raw.githubusercontent.com/leejiazhi88-gif/1-BigA-total/{BASE}/work/holding_denominators.json"
    audit = json.load(urllib.request.urlopen(url, timeout=60))
    early = read(ROOT / ".tools/national-team-stock-history/ratio-capital-export.json")
    if early["failures"]:
        raise ValueError("Unresolved historical A-share capital")
    verified = read(ROOT / "work/national_team_stock_history.json")["stocks"]
    periods = [p for p in early["stocks"] if p < "20150000" and p in verified]
    if len(periods) != 13:
        raise ValueError("Unexpected early denominator count")
    audit["stocks"] = dict(sorted({**{p: early["stocks"][p] for p in periods}, **audit["stocks"]}.items()))
    save(ROOT / "work/holding_denominators.json", audit)
    print(json.dumps({"earlyPeriods": periods, "totalPeriods": len(audit["stocks"])}))


if __name__ == "__main__":
    main()
