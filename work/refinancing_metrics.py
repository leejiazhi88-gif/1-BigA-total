"""Completed equity issuance amounts by Shanghai/Shenzhen market."""
import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fetch_large_money_sentiment_data import sh_sz_a_share


def positive(value):
    try:
        amount = Decimal(str(value))
        return amount if amount.is_finite() and amount > 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def normalize_issuances(additional, rights, listing_dates, end_date):
    records, excluded, seen = [], [], set()
    for kind, rows, date_field in (("additional", additional, "ISSUE_DATE"), ("rights", rights, "PAY_END_DATE")):
        for row in rows:
            day = str(row.get(date_field) or "")[:10]
            if not day or not "2008-01-01" <= day <= end_date:
                continue
            date.fromisoformat(day)
            code = row.get("SECUCODE")
            if not row.get("FINANCE_CODE"):
                raise ValueError("Missing issuance identity")
            identity = (kind, str(row["FINANCE_CODE"]))
            if identity in seen:
                raise ValueError(f"Duplicate issuance: {identity}")
            seen.add(identity)
            reason = None
            if not sh_sz_a_share(code):
                reason = "Not a Shanghai/Shenzhen A share"
            else:
                listing = listing_dates.get(code)
                if not listing:
                    raise ValueError(f"Initial listing date missing: {code}")
                listing = f"{listing[:4]}-{listing[4:6]}-{listing[6:]}" if "-" not in listing else listing
                date.fromisoformat(listing)
                if day <= listing:
                    reason = "Initial offering before/on first listing date"
            if reason:
                excluded.append({"type": kind, "id": identity[1], "code": code, "date": day, "reason": reason})
                continue
            total = positive(row.get("TOTAL_RAISE_FUNDS"))
            shares, price = positive(row.get("ISSUE_NUM")), positive(row.get("ISSUE_PRICE"))
            amount = total if total is not None else shares * price if shares is not None and price is not None else None
            records.append({
                "type": kind, "id": identity[1], "code": code, "name": row.get("SECURITY_NAME_ABBR"),
                "date": day, "market": code[-2:].lower(), "initialListingDate": listing,
                "amountYuan": float(amount) if amount is not None else None,
                "amountSource": "TOTAL_RAISE_FUNDS" if total is not None else "ISSUE_NUM * ISSUE_PRICE" if amount is not None else None,
                "reportedAmountYuan": row.get("TOTAL_RAISE_FUNDS"), "issueShares": row.get("ISSUE_NUM"),
                "issuePrice": row.get("ISSUE_PRICE"), "issueWay": row.get("ISSUE_WAY") or "配股",
                "listingDate": str(row.get("ISSUE_LISTING_DATE") or row.get("LISTING_DATE") or "")[:10] or None,
            })
    return sorted(records, key=lambda row: (row["date"], row["type"], row["id"])), excluded


def aggregate_refinancing(records, current_month, start_month="2008-01"):
    buckets = defaultdict(lambda: {"additional": Decimal(0), "rights": Decimal(0), "records": 0, "missingAmounts": 0})
    for row in records:
        month = row["date"][:7]
        if not start_month <= month < current_month:
            continue
        bucket = buckets[(month, row["market"])]
        bucket["records"] += 1
        amount = positive(row["amountYuan"])
        if amount is None:
            bucket["missingAmounts"] += 1
        else:
            bucket[row["type"]] += amount
    output = {market: [] for market in ("all", "sh", "sz")}
    year, month = map(int, start_month.split("-"))
    while f"{year}-{month:02d}" < current_month:
        key = f"{year}-{month:02d}"
        day = f"{key}-{calendar.monthrange(year, month)[1]}"
        for market in ("sh", "sz"):
            bucket = buckets[(key, market)]
            values = [None, None] if bucket["missingAmounts"] else [
                float((bucket[kind] / Decimal(100000000)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                for kind in ("additional", "rights")]
            output[market].append({"date": day, "refinanceFunds": round(sum(values), 2) if None not in values else None,
                                   "additionalFunds": values[0], "rightsFunds": values[1],
                                   "coverage": {field: bucket[field] for field in ("records", "missingAmounts")}})
        sh, sz = output["sh"][-1], output["sz"][-1]
        total = {"date": day, "coverage": {field: sh["coverage"][field] + sz["coverage"][field]
                                            for field in ("records", "missingAmounts")}}
        for field in ("refinanceFunds", "additionalFunds", "rightsFunds"):
            total[field] = round(sh[field] + sz[field], 2) if sh[field] is not None and sz[field] is not None else None
        output["all"].append(total)
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return {"series": output.pop("all"), "markets": output}
