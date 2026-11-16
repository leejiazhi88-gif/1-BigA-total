"""Read-only inventory of the main dashboard's local sources (no API imports)."""
import json
import math
from datetime import date, datetime
from pathlib import Path


def _date(value):
    text = str(value)
    if len(text) == 7 and text[4] == "-":
        text += "-01"
    return date.fromisoformat(text[:10]) if "-" in text[:10] else datetime.strptime(text[:8], "%Y%m%d").date()


def applicable_periods(end):
    """Periods whose disclosure deadlines have passed, including annual and Q1."""
    end = _date(end)
    year = end.year
    if end <= date(year, 4, 30):
        return [f"{year - 1}0930"]
    periods = [f"{year - 1}1231", f"{year}0331"]
    if end > date(year, 8, 31):
        periods.append(f"{year}0630")
    if end > date(year, 10, 31):
        periods.append(f"{year}0930")
    return periods


def _get(value, path):
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _has(value, path):
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return False
        value = value[key]
    return True


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _nonfinite(value):
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(_nonfinite(v) for v in value.values())
    if isinstance(value, list):
        return any(_nonfinite(v) for v in value)
    return False


def audit_inventory(root, end, job_results=None, state=None):
    """Return JSON-safe ``rows`` and string ``blockingIssues`` without writing.

    Each row has id, label, job (None for manual audits), source, frequency,
    latest (last actual non-null observation), checkedAt, status and reason.
    checkedAt comes from source metadata or a successful job's recorded state;
    an audit-only call never claims a source check. Declared unavailable/low
    coverage/pending company capital are nonblocking; corrupt or absent sources,
    failed refreshes and missing applicable audits/denominators block.
    """
    cutoff = _date(end)
    expected = applicable_periods(end)
    job_results, state = job_results or {}, state or {}
    rows, cache, errors = [], {}, {}

    def load(name):
        if name not in cache:
            try:
                data = json.loads((Path(root) / "work" / (name + ".json")).read_text())
                if not isinstance(data, dict):
                    raise ValueError("expected JSON object")
                if _nonfinite(data):
                    raise ValueError("nonfinite numeric value")
                cache[name] = data
            except (OSError, ValueError) as exc:
                cache[name] = {}
                errors[name] = str(exc)
        return cache[name]

    def add(identifier, label, name, job, frequency, latest=None, status="ok", reason="", meta=None):
        data = load(name)
        metadata = meta if meta is not None else data.get("meta", data)
        checked = next((metadata.get(k) for k in ("checkedAt", "checked_at", "checkedThrough", "updated")
                        if metadata.get(k)), None)
        result = job_results.get(job, {})
        # State is written only for successful jobs by the refresh runner.
        saved = state.get(job, {})
        if result.get("status") in ("ok", "reused_success"):
            checked = result.get("checkedAt") or saved.get("checkedAt") or checked
        elif not checked:
            checked = saved.get("checkedAt")
        problems = []
        if name in errors:
            problems.append("missing/invalid source: " + errors[name])
        if data.get("failures"):
            problems.append("source contains unresolved failures")
        if result.get("status") in ("failed", "failed_cached", "failed_validation"):
            problems.append("refresh " + result["status"] + "; cached data is not a successful check")
        if checked:
            try:
                if _date(checked) > cutoff:
                    problems.append("future checkedAt")
            except ValueError:
                problems.append("invalid checkedAt")
        if problems:
            status, reason = "failed", "; ".join(problems + ([reason] if reason else []))
        elif not checked:
            reason = "; ".join(filter(None, [reason, "source check date not recorded"]))
        row = dict(id=identifier, label=label, job=job, source="work/" + name + ".json",
                   frequency=frequency, latest=latest, checkedAt=checked, status=status,
                   reason=reason or "actual source observations; no extrapolation")
        rows.append(row)
        return row

    def issue(row, reason):
        row["status"] = "failed"
        row["reason"] = "; ".join(filter(None, [row["reason"], reason]))

    def timeline(points, key="date"):
        if not isinstance(points, list):
            return "missing series"
        try:
            dates = [_date(p[key]) for p in points]
        except (ValueError, KeyError, TypeError):
            return "invalid observation date/shape"
        if len(set(dates)) != len(dates):
            return "duplicate observation dates"
        if dates != sorted(dates):
            return "unordered observation dates"
        if any(d > cutoff for d in dates):
            return "future observation dates"
        return None

    def metric(identifier, label, name, job, frequency, path, field, key="date", date_field=None, meta=None):
        data = load(name)
        points = _get(data, path)
        problem = timeline(points, key)
        valid = [p for p in (points or []) if isinstance(p, dict) and _finite(_get(p, field))] if isinstance(points, list) else []
        latest = max((p.get(date_field or key) or p[key] for p in valid), default=None)
        row = add(identifier, label, name, job, frequency, latest,
                  "ok" if valid else "unavailable", "" if valid else "no non-null source observations", meta)
        if problem:
            issue(row, problem)
        if isinstance(points, list):
            if not points:
                issue(row, "required history series is empty")
            elif not any(_has(p, field) for p in points):
                issue(row, "required field absent from entire history: " + field)
            if any(_get(p, field) is not None and not _finite(_get(p, field)) for p in points):
                issue(row, "invalid numeric observation: " + field)
            tail = [p for p in points if isinstance(p, dict) and field.split(".")[0] in p]
            if tail and not _finite(_get(tail[-1], field)) and row["status"] == "ok":
                row.update(status="unavailable", reason="latest source observation is explicitly null; latest is last valid value")
        return row

    for market in ("sh", "sz"):
        for field in ("close", "pe", "profit"):
            metric(f"overview.{market}.{field}", f"Overview {market} {field}", "market_overview_data",
                   "market_overview", "daily", "prices." + market if field == "close" else market, field)
        for field in ("pe", "pb", "equityBondSpread"):
            metric(f"valuation.{market}.{field}", f"Valuation {market} {field}", "valuation_data",
                   "valuation", "weekly", market, field)
    for field in ("amount", "volume"):
        metric("overview.trading." + field, "Overview trading " + field, "market_overview_data",
               "market_overview", "daily", "trading", field)
    market_latest = max((r["latest"] for r in rows if r["id"].startswith("overview.") and r["latest"]), default=None)
    for market, path in (("all", "series"), ("sh", "markets.sh"), ("sz", "markets.sz")):
        for field in ("amount", "volume", "turnover", "marginBalance", "marginFloatRatio", "marginBuyRatio", "limitUpCount"):
            # Market splits do not expose these two national-only metrics.
            if market != "all" and field in ("marginBuyRatio", "limitUpCount"):
                continue
            row = metric(f"retail.{market}.{field}", f"Retail {market} {field}", "retail_sentiment_data",
                         "retail_sentiment", "weekly", path, field)
            if field in ("amount", "volume", "turnover") and market_latest and row["latest"] and row["latest"] < market_latest and row["status"] == "ok":
                row.update(status="lagging", reason=f"actual observation precedes overview market latest {market_latest}; source availability requires review")
        for field, actual_date in (("blockAmount", "blockDate"), ("institutionBlockNet", "blockDate"), ("holderNetShares", "holderDate")):
            row = metric(f"institutional.{market}.{field}", f"Institutional {market} {field}", "large_money_sentiment_data",
                         "large_money_sentiment", "weekly", path, field, date_field=actual_date)
            if market_latest and row["latest"] and row["latest"] < market_latest and row["status"] == "ok":
                row.update(status="lagging", reason=f"actual observation precedes overview market latest {market_latest}; no carry-forward")
        for field in ("value", "ratio"):
            row = metric(f"institutional.{market}.north.{field}", f"Northbound holdings {market} {field}", "northbound_holdings",
                         "northbound", "quarterly", "series", market + "." + field)
            last = load("northbound_holdings").get("series", [])
            if last and last[-1].get(market, {}).get("status") != "available" and row["status"] != "failed":
                row.update(status="unavailable", reason="latest source status: " + str(last[-1].get(market, {}).get("status")))
        for field in ("position", "concentration"):
            metric(f"institutional.{market}.{field}", f"Active fund {market} {field}", "large_money_fund_reports",
                   "fund_reports", "semiannual", "series", market + "." + field)
        metric(f"institutional.{market}.etfShares", f"ETF shares {market}", "large_money_etf_shares",
               "etf_shares", "weekly", "series", market)
        for field in ("ipoFunds", "netReduceAmount"):
            metric(f"official.{market}.{field}", f"Official {market} {field}", "official_sentiment_data",
                   "official_sentiment", "weekly", path, field)
        metric(f"official.{market}.refinance", f"Refinancing {market}", "refinancing_data", "refinancing",
               "monthly", path, "refinanceFunds")

    metric("retail.accounts", "Monthly new accounts", "retail_monthly_trends", "monthly", "monthly", "accounts", "accountsWan", "month")
    row = metric("retail.funds", "Monthly new funds", "retail_monthly_trends", "monthly", "monthly", "funds", "sharesYi", "month")
    monthly = load("retail_monthly_trends")
    if monthly.get("funds"):
        point = monthly["funds"][-1]
        if point.get("coverage", 100) < monthly.get("meta", {}).get("fundCoverageThreshold", 90) and row["status"] != "failed":
            row.update(status="low_coverage", reason=f"latest month {point['month']} coverage {point.get('coverage')}% below source threshold; incomplete issuance shares")
    official = load("official_sentiment_data")
    metric("official.tax", "Stamp tax", "official_sentiment_data", "official_sentiment", "policy event", "series", "stampTaxRate")
    for path, field in (("reverseRepo", "reverseRepo7d"), ("lpr", "lpr1y"), ("lpr", "lpr5y")):
        metadata = {**official.get("meta", {}), **(_get(official, path + ".meta") or {})}
        metric("official." + field, field, "official_sentiment_data", "official_sentiment", "policy event" if path == "reverseRepo" else "monthly quote", path + ".series", field, meta=metadata)
    for kind in ("m2", "social"):
        for field in ("value", "yoy"):
            metric(f"official.{kind}.{field}", f"Macro {kind} {field}", "official_sentiment_data", "official_sentiment", "monthly", f"macro.{kind}.series", field)
    metric("institutional.etfFlow", "ETF subscription/redemption proxy", "etf_flow_data", "etf_flow", "daily", "series", "total")
    metric("institutional.northFlow", "Historical northbound flow", "large_money_sentiment_data", "large_money_sentiment", "historical weekly", "series", "northMoney", date_field="northDate")
    metric("institutional.nationalExposure", "National team bottom-up ETF exposure", "national_team_etf_data", "national_team", "report", "history", "averageExposure")

    diagnostic = load("active_fund_report_audit")
    row = add("institutional.latestFundAudit", "Latest active fund report audit", "active_fund_report_audit", "fund_report_audit", "quarterly", diagnostic.get("quarter"))
    if diagnostic.get("quarter") != expected[-1]:
        issue(row, "missing applicable report audit " + expected[-1])
    elif diagnostic.get("sameMethodAvailable") is False and row["status"] != "failed":
        row.update(status="low_coverage", reason=f"report {diagnostic['quarter']} coverage {diagnostic.get('coverage')}% below {diagnostic.get('threshold')}%; semiannual complete-portfolio series retained")

    stocks = load("national_team_stock_history")
    social = load("social_security_history")
    etf = load("national_team_etf_history")
    capital = load("holding_denominators")
    aggregate = load("a_share_market_cap")
    disclosure = load("disclosure_status")
    stock_points = stocks.get("stocks", {})
    social_points = {p["period"]: p for p in social.get("snapshots", [])}
    summaries = {p["period"]: p for p in etf.get("summaries", [])}
    direct_rows = {}
    for key, name, points in (("stocks", "national_team_stock_history", stock_points), ("social", "social_security_history", social_points), ("etf", "national_team_etf_history", summaries)):
        row = add("direct." + key, "Direct named holdings " + key, name, None, "quarterly", max(points, default=None))
        direct_rows[key] = row
        missing = [p for p in expected if p not in points]
        if missing:
            issue(row, "missing applicable report periods " + ", ".join(missing))
        if not row["checkedAt"]:
            issue(row, "manual report audit date missing")
        for p, snapshot in points.items():
            if _date(p) > cutoff:
                issue(row, "future report period " + p)
            if key != "etf":
                seen_details = set()
                for detail in snapshot.get("details", []):
                    if detail.get("end_date", detail.get("period")) != p:
                        issue(row, "mixed holding report periods " + p)
                        break
                    units = detail.get("a_share_amount" if key == "stocks" else "units")
                    amount = detail.get("value_yi" if key == "stocks" else "amount")
                    close = detail.get("close")
                    identity = (detail.get("ts_code", detail.get("code")), detail.get("holder_name", detail.get("holder")))
                    if (identity in seen_details or not all(_finite(v) for v in (units, amount, close))
                            or units <= 0 or close <= 0 or abs(units * close / 1e8 - amount) > .01):
                        issue(row, "invalid/duplicate holding numerator " + p)
                        break
                    seen_details.add(identity)
        if key == "etf" and summaries.get(expected[-1], {}).get("amount") is None and row["status"] != "failed":
            row.update(status="unavailable", reason="named holder tables not disclosed; report checks retained, holdings null (not zero)")
        if key == "stocks" and stocks.get("gaps"):
            row["reason"] += "; documented early low-coverage quarters remain null"
    for name, points, key in (("social_security_history", social.get("snapshots"), "period"), ("national_team_etf_history", etf.get("summaries"), "period")):
        problem = timeline(points, key)
        if problem:
            issue(direct_rows["social" if name.startswith("social") else "etf"], problem)

    # Every eligible ETF needs a report check; a null aggregate alone is not evidence.
    reports = etf.get("reports", [])
    seen = set()
    for report in reports:
        identity = (report.get("code"), report.get("period"), report.get("kind"))
        if identity in seen:
            issue(direct_rows["etf"], "duplicate ETF report")
            break
        seen.add(identity)
        if report.get("issues") or report.get("status") not in ("identified", "no_identified_account_in_top10", "named_holder_table_not_disclosed"):
            issue(direct_rows["etf"], "ETF report needs parse/integrity review")
            break
    for period in expected:
        kind = "annual" if period.endswith("1231") else "interim" if period.endswith("0630") else "quarterly"
        for fund in etf.get("funds", []):
            if fund["inception"] <= period and (fund["code"], period, kind) not in seen:
                issue(direct_rows["etf"], f"missing ETF report check {fund['code']} {period} {kind}")

    row = add("direct.aggregateDenominator", "All-A same-period market denominator", "a_share_market_cap", None, "quarterly", max(aggregate.get("periods", {}), default=None))
    for period in expected:
        point = aggregate.get("periods", {}).get(period, {})
        if point.get("period") != period or not _finite(point.get("amount")) or point.get("amount", 0) <= 0 or not point.get("count"):
            issue(row, "missing/invalid aggregate denominator " + period)
        elif not point.get("date") or point["date"] > period or point["date"][:6] != period[:6]:
            issue(row, "aggregate denominator date mismatch " + period)
    company_row = add("direct.companyDenominator", "Company A-share capital denominators", "holding_denominators", None, "quarterly", max(capital.get("stocks", {}), default=None))
    fund_row = add("direct.etfDenominator", "Named ETF same-period denominators", "holding_denominators", None, "report", max((v.get("period", "") for v in capital.get("funds", {}).values()), default=None))
    pending = disclosure.get("pendingCapitalPeriods", [])
    for period in expected:
        if period in pending:
            if company_row["status"] != "failed":
                company_row.update(status="pending", reason="per-company audited A-share capital pending for " + period + "; aggregate same-period market denominator is required separately")
            continue
        details = stock_points.get(period, {}).get("details", []) + social_points.get(period, {}).get("details", [])
        for detail in details:
            code = detail.get("ts_code", detail.get("code"))
            denominator = capital.get("stocks", {}).get(period, {}).get(code, {})
            if not _finite(denominator.get("shares")) or denominator.get("shares", 0) <= 0:
                issue(company_row, "missing/invalid company denominator " + period + " " + str(code))
                break
    for report in reports:
        if report.get("status") != "identified":
            continue
        if (not all(_finite(report.get(k)) for k in ("units", "nav", "value_yi"))
                or report.get("units", 0) <= 0 or report.get("nav", 0) <= 0
                or abs(report["units"] * report["nav"] / 1e8 - report["value_yi"]) > .01):
            issue(direct_rows["etf"], "invalid ETF holding numerator " + report["code"] + ":" + report["period"])
            continue
        denominator = capital.get("funds", {}).get(report["code"] + ":" + report["period"], {})
        if (denominator.get("period") != report["period"] or not all(_finite(denominator.get(k)) for k in ("units", "nav", "amount"))
                or denominator.get("units", 0) <= 0 or denominator.get("nav") != report.get("nav")
                or not _finite(report.get("units")) or report["units"] > denominator.get("units", 0)
                or abs(denominator.get("amount", 0) - denominator.get("units", 0) * report.get("nav", 0) / 1e8) > .01):
            issue(fund_row, "missing/invalid same-period ETF denominator " + report["code"] + ":" + report["period"])
            break
    if "disclosure_status" in errors:
        issue(company_row, "missing/invalid disclosure_status.json")
    labels = {
        "Overview": "市场总览", "Valuation": "估值", "Retail": "散户指标",
        "Institutional": "大资金指标", "Official": "官方指标",
        "Active fund": "主动权益基金", "Northbound holdings": "北向持仓",
        "ETF shares": "ETF份额", "Refinancing": "再融资额",
        "Monthly new accounts": "月度新增开户", "Monthly new funds": "月度新发基金",
        "Stamp tax": "印花税率", "Macro": "宏观指标",
        "ETF subscription/redemption proxy": "ETF申赎代理指标",
        "Historical northbound flow": "历史北向资金流",
        "National team bottom-up ETF exposure": "国家队ETF穿透敞口",
        "Latest active fund report audit": "主动权益基金最新季报覆盖审计",
        "Direct named holdings": "具名直接持仓",
        "All-A same-period market denominator": "同报告期全A股市值分母",
        "Company A-share capital denominators": "逐公司A股股本分母",
        "Named ETF same-period denominators": "具名ETF同报告期份额分母",
        "close": "指数收盘", "profit": "过去12个月合计利润", "pe": "市盈率",
        "pb": "市净率", "equityBondSpread": "股债利差", "trading": "交易规模",
        "amount": "成交额", "volume": "成交量", "turnover": "换手率",
        "marginBalance": "融资余额", "marginFloatRatio": "融资余额/流通市值",
        "marginBuyRatio": "融资买入占比", "limitUpCount": "涨停家数",
        "blockAmount": "大宗交易额", "institutionBlockNet": "机构大宗净买入",
        "holderNetShares": "产业资本净增减持", "value": "金额", "ratio": "占比",
        "position": "仓位", "concentration": "持仓集中度", "ipoFunds": "IPO融资额",
        "netReduceAmount": "产业资本净减持额", "reverseRepo7d": "7天逆回购利率",
        "lpr1y": "1年期LPR", "lpr5y": "5年期LPR", "yoy": "同比",
        "m2": "M2", "social": "社融", "stocks": "国家队股票", "etf": "ETF",
        "all": "两市合计", "sh": "沪市", "sz": "深市",
    }
    statuses = {"ok": "正常", "failed": "失败（阻断）", "unavailable": "源数据暂不可用（不阻断）",
                "low_coverage": "覆盖不足（不阻断）", "pending": "已知待审计（不阻断）",
                "lagging": "观测日期滞后（不阻断）"}
    for row in rows:
        for english in sorted(labels, key=len, reverse=True):
            # Replace whole label words, so 'pe' cannot alter 'spread'.
            row["label"] = (" " + row["label"] + " ").replace(" " + english + " ", " " + labels[english] + " ").strip()
        if row["id"] == "direct.social":
            row["label"] = "具名社保组合直接持仓"
        row["statusLabel"] = statuses[row["status"]]
        for english, chinese in {
            "actual source observations; no extrapolation": "使用实际观测，不向后填充",
            "latest source observation is explicitly null; latest is last valid value": "最新观测为空；所列日期为最后有效值日期",
            "latest source status: incomplete": "最新一期合计数据不完整，保留缺失",
            "latest source status: conflicting_records": "最新一期来源记录冲突，保留缺失",
            "named holder tables not disclosed; report checks retained, holdings null (not zero)": "已核查报告，未披露具名持有人表；持仓留空，不表示清仓",
            "documented early low-coverage quarters remain null": "历史覆盖不足季度留空，详见原核查记录",
            "source check date not recorded": "未记录来源核验日期",
        }.items():
            row["reason"] = row["reason"].replace(english, chinese)
    return {"requestedEnd": cutoff.strftime("%Y%m%d"), "expectedPeriods": expected, "rows": rows,
            "blockingIssues": [r["id"] + ": " + r["reason"] for r in rows if r["status"] == "failed"]}
