"""Audit named national-team ETF holders in public periodic reports."""

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools" / "national-team-history"
OUTPUT = ROOT / "work" / "national_team_etf_history.json"
FUNDS = {
    "510050": "华夏上证50ETF", "510300": "华泰柏瑞沪深300ETF",
    "510310": "易方达沪深300ETF", "510330": "华夏沪深300ETF",
    "159919": "嘉实沪深300ETF", "510500": "南方中证500ETF",
    "159922": "嘉实中证500ETF", "510580": "易方达中证500ETF",
    "512100": "南方中证1000ETF", "159845": "华夏中证1000ETF",
    "560010": "广发中证1000ETF", "159915": "易方达创业板ETF",
    "588000": "华夏科创50ETF", "588080": "易方达科创50ETF",
}
START = "20150630"
HOLDER = re.compile(r"中央汇金|中国证券金融|中国证金")
TABLE = re.compile(r"期末(?:上市)?基金前十名(?:份额)?持有人")
NUMBER = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+")


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch(url, path, refresh=False):
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    for attempt in range(3):
        try:
            response = subprocess.run([
                "curl", "-fsSL", "--connect-timeout", "10", "--max-time", "30",
                "-H", "Referer: https://fundf10.eastmoney.com/", url,
            ], capture_output=True, text=True, check=True)
            value = json.loads(response.stdout)
            if not isinstance(value, dict) or not ("Data" in value or value.get("data")):
                raise ValueError("Empty report API response")
            save(path, value)
            return value
        except (subprocess.SubprocessError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def report_period(title):
    title = re.sub(r"\s", "", title)
    year = re.search(r"(20\d{2})年", title)
    if not year or "摘要" in title:
        return None
    year = year[1]
    quarter = re.search(r"第([一二三四1234])季度报告", title)
    if quarter:
        q = "一二三四".find(quarter[1]) + 1 if not quarter[1].isdigit() else int(quarter[1])
        return year + ("0331", "0630", "0930", "1231")[q - 1], "quarterly"
    if "半年度报告" in title or "中期报告" in title:
        return year + "0630", "interim"
    if "年度报告" in title:
        return year + "1231", "annual"
    return None


def report_document(item):
    path = CACHE / (item["ID"] + ".json")
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))["data"]
        if "基金" in re.sub(r"\s", "", cached["notice_content"]):
            return cached
    # The PDF is the original disclosure and remains available when the text
    # endpoint resets connections. Preserve a local copy and extraction method.
    from pypdf import PdfReader
    from pypdf.generic import NameObject
    url = "https://pdf.dfcfw.com/pdf/H2_%s_1.pdf" % item["ID"]
    pdf = CACHE / (item["ID"] + ".pdf")
    if not pdf.exists():
        subprocess.run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "10", "--max-time", "40", url,
                        "-o", str(pdf)], capture_output=True, check=True)
    reader = PdfReader(pdf)
    repaired = False
    for page in reader.pages:
        for reference in page.get("/Resources", {}).get("/Font", {}).values():
            font = reference.get_object()
            encoding = font.get("/Encoding")
            if hasattr(encoding, "get_data") and b"Oracle-UCS2" in encoding.get_data():
                # These CMaps explicitly use UCS-2 character codes. Decode as
                # two-byte Unicode for extraction; the source PDF is untouched.
                font[NameObject("/Encoding")] = NameObject("/Identity-H")
                repaired = True
    body = "\n".join(page.extract_text(extraction_mode="layout") for page in reader.pages)
    body = re.sub(r"(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])", "", body)
    data = {"notice_title": item["TITLE"], "notice_content": body, "attach_url": url,
            "extraction": "original_pdf_pypdf_layout" + ("_oracle_ucs2" if repaired else "")}
    save(path, {"data": data})
    return data


def parse_report(text):
    text = re.sub(r"[ \t]{2,}", "  ", text)
    compact = re.sub(r"\s", "", text)
    inception = re.search(r"基金合同生效日[（(]?(20\d{2})年(\d{1,2})月(\d{1,2})日", compact)
    inception = "%s%02d%02d" % (inception[1], int(inception[2]), int(inception[3])) if inception else None
    nav_label = r"\s*".join("期末基金份额净值")
    nav_match = re.search(nav_label + r"[\s（()）元]*([0-9]+\.[0-9]+)", text)
    if not nav_match:
        nav_match = re.search(r"报告期末[，,]?(?:本)?基金份额净值为\s*([0-9]+\.[0-9]+)", compact)
    nav = float(nav_match[1]) if nav_match else None
    result = {"inception": inception, "nav": nav, "nav_evidence": nav_match[0] if nav_match else None,
              "holders": [], "table_disclosed": False,
              "status": "named_holder_table_not_disclosed", "issues": []}
    if "基金" not in compact or "报告" not in compact:
        result["status"] = "parse_review_required"
        result["issues"].append("Unreadable report text")
        return result
    matches = list(TABLE.finditer(text))
    # The table of contents contains the same heading; use the last section heading.
    if not matches:
        result["anonymous_large_holder_table"] = bool(re.search(r"单一投资者持有基金份额比例达到或超过20%", compact))
        return result
    start = matches[-1].start()
    after = text[start:]
    end = re.search(r"\n\s*\d{1,2}\.\d+\s*期末基金管理人", after)
    table = after[:end.start()] if end else after[:6000]
    result["table_disclosed"] = True
    result["table_evidence"] = table
    anchors, starts = [], []
    for match in re.finditer(r"(?m)^[ \t]*(\d{1,2})[ \t]+([^\n]+)", table):
        if int(match[1]) == len(starts) + 1 and int(match[1]) <= 11:
            starts.append(match)
    for i, match in enumerate(starts):
        block = table[match.start(2):starts[i + 1].start() if i + 1 < len(starts) else len(table)]
        nums = list(NUMBER.finditer(block))
        large = [n for n in nums if float(n[0].replace(",", "")) > 100]
        # A linked fund may follow rank ten without a rank; it is not part of
        # the top-ten row. Only the first units column belongs to that row.
        if large and (len(large) == 1 or int(match[1]) == 10) and 1 <= int(match[1]) <= 11:
            small = [float(n[0]) for n in nums if "," not in n[0] and float(n[0]) <= 100]
            anchors.append({"rank": int(match[1]), "units": float(large[0][0].replace(",", "")),
                            "offset": match.start(2) + large[0].start(),
                            "ratio_pct": small[0] if small else None})
    # Keep a character map so wrapped account names can be assigned to their
    # numeric row even when the PDF places the rank in the middle of the name.
    chars = [(i, ch) for i, ch in enumerate(table) if "\u4e00" <= ch <= "\u9fff"]
    names = "".join(ch for _, ch in chars)
    accounts = re.compile(r"中央汇金(?:投资|资产管理)有限责任公司|中国证券金融股份有限公司|中国证金")
    used = set()
    for match in accounts.finditer(names):
        first, last = chars[match.start()][0], chars[match.end() - 1][0]
        following = [a for a in anchors if a["rank"] <= 10 and first < a["offset"] <= last + 150]
        candidates = following[:1]
        if len(candidates) != 1 or candidates[0]["rank"] in used:
            result["issues"].append("Ambiguous row for " + match[0])
            continue
        anchor = candidates[0]
        used.add(anchor["rank"])
        result["holders"].append({k: v for k, v in anchor.items() if k != "offset"})
        result["holders"][-1].update({"account": match[0], "evidence": table[max(0, first - 15):max(last, anchor["offset"] + 50)].strip()})
    ranks = [a["rank"] for a in anchors if a["rank"] <= 10]
    if ranks != list(range(1, 11)):
        result["issues"].append("Incomplete top-ten parsing: " + str(ranks))
    named_in_table = bool(HOLDER.search(names))
    if named_in_table and not result["holders"]:
        result["issues"].append("Named account found but not parsed")
    if result["holders"] and (nav is None or not 0 < nav < 100):
        result["issues"].append("Missing or invalid period NAV")
    result["status"] = "parse_review_required" if result["issues"] else (
        "identified" if result["holders"] else "no_identified_account_in_top10")
    if result["status"] == "identified":
        result["units"] = sum(r["units"] for r in result["holders"])
        result["value_yi"] = result["units"] * nav / 1e8
    return result


def collect(as_of, codes, refresh):
    rows, failures = [], []
    for code in codes:
        listings = []
        page = 1
        while True:
            url = "https://api.fund.eastmoney.com/f10/JJGG?" + urllib.parse.urlencode({
                "fundcode": code, "pageIndex": page, "pageSize": 100, "type": 3})
            listing = fetch(url, CACHE / (code + "-listing-%s.json" % page), refresh)
            entries = listing["Data"]
            listings.extend(entries)
            if len(listings) >= listing["TotalCount"] or (entries and entries[-1]["PUBLISHDATE"][:10].replace("-", "") < START):
                break
            if not entries:
                raise ValueError("Unexpected empty listing page")
            page += 1
        reports = {}
        for item in listings:
            key = report_period(item["TITLE"])
            if not key or key[0] < START or item["PUBLISHDATE"][:10].replace("-", "") > as_of:
                continue
            if key not in reports or (item["PUBLISHDATE"], item["ID"]) > (reports[key]["PUBLISHDATE"], reports[key]["ID"]):
                reports[key] = item
        for (period, kind), item in sorted(reports.items()):
            try:
                report = report_document(item)
                body = report.get("notice_content", "")
                if len(body) < 1000:
                    raise ValueError("Missing report full text")
                parsed = parse_report(body)
                rows.append({"code": code, "period": period, "kind": kind,
                             "announced": item["PUBLISHDATE"][:10], "title": item["TITLE"],
                             "source": "https://fund.eastmoney.com/gonggao/%s,%s.html" % (code, item["ID"]),
                             "pdf": report.get("attach_url"), "report_id": item["ID"],
                             "text_sha256": hashlib.sha256(body.encode()).hexdigest(), **parsed})
            except (ValueError, KeyError, subprocess.SubprocessError) as error:
                failures.append({"code": code, "period": period, "kind": kind, "report_id": item["ID"], "error": str(error)})
        print(code, len(reports), dict(Counter(r["status"] for r in rows if r["code"] == code)), flush=True)
        save(CACHE / (code + "-audit.json"), {"checked_at": as_of, "reports": rows, "failures": failures})
    return rows, failures


def summarize_period(reports, funds, period):
    eligible = [f for f in funds if f["inception"] <= period]
    preferred = "interim" if period.endswith("0630") else "annual" if period.endswith("1231") else "quarterly"
    rows = []
    for fund in eligible:
        candidates = [r for r in reports if r["code"] == fund["code"] and r["period"] == period]
        row = next((r for r in candidates if r["kind"] == preferred), None)
        if row is None:
            row = next((r for r in candidates if r["kind"] == "quarterly"), None)
        if row:
            rows.append(row)
    identified = [r for r in rows if r["status"] == "identified"]
    disclosed = sum(r["table_disclosed"] for r in rows)
    complete = bool(identified) and disclosed == len(eligible)
    return {"period": period, "eligible": len(eligible), "disclosed": disclosed,
            "identified": len(identified), "amount": sum(r["value_yi"] for r in identified) if complete else None}


def export_history(as_of):
    draft = json.loads((CACHE / "audit-draft.json").read_text(encoding="utf-8"))
    rows = draft["reports"]
    # Reparse saved original text after parser refinements, without redownloading.
    for i, row in enumerate(rows):
        body = json.loads((CACHE / (row["report_id"] + ".json")).read_text(encoding="utf-8"))["data"]["notice_content"]
        metadata = {k: row[k] for k in ("code", "period", "kind", "announced", "title", "source", "pdf", "report_id", "text_sha256")}
        metadata["text_sha256"] = hashlib.sha256(body.encode()).hexdigest()
        rows[i] = {**metadata, **parse_report(body)}
    issues = [r for r in rows if r["issues"]]
    save(CACHE / "audit-draft.json", {**draft, "reports": rows})
    if draft["failures"] or issues:
        raise ValueError("Unresolved downloads: %s; parsing: %s" % (len(draft["failures"]), len(issues)))
    funds = []
    for code, name in FUNDS.items():
        inceptions = {r["inception"] for r in rows if r["code"] == code and r["inception"]}
        if len(inceptions) != 1:
            raise ValueError("Ambiguous fund inception %s: %s" % (code, inceptions))
        funds.append({"code": code, "name": name, "inception": next(iter(inceptions))})
    periods = [str(year) + end for year in range(2015, int(as_of[:4]) + 1)
               for end in ("0331", "0630", "0930", "1231") if START <= str(year) + end <= as_of]
    # Reconcile against the separately audited annual snapshot already in use.
    audited = json.loads((ROOT / "outputs/national-team-holdings-comparison-20261026.json").read_text(encoding="utf-8"))
    for known in audited["etfs_20251231"]["rows"]:
        current = next(r for r in rows if r["code"] == known["code"] and r["period"] == "20251231" and r["kind"] == "annual")
        if current["status"] != known["status"] or (current["status"] == "identified" and (
                abs(current["units"] - known["units"]) > 0.001 or abs(current["value_yi"] - known["value_yi"]) > 0.01)):
            raise ValueError("Annual audited snapshot mismatch: " + known["code"])
    summaries = [summarize_period(rows, funds, p) for p in periods]
    result = {"checked_at": "%s-%s-%s" % (as_of[:4], as_of[4:6], as_of[6:]), "start": START,
              "currency": "CNY", "amount_unit": "亿元", "funds": funds, "periods": periods,
              "summaries": summaries, "reports": sorted(rows, key=lambda r: (r["period"], r["code"], r["kind"])), "failures": []}
    save(OUTPUT, result)
    quarterly = [r for r in rows if r["kind"] == "quarterly"]
    lines = ["# 国家队ETF历史具名持仓核查", "", "核验日期：" + result["checked_at"], "",
             "范围：页面14只宽基ETF，回溯2015-06-30。核查%s份报告，其中季报%s份，季报具名持有人表%s份。" % (
                 len(rows), len(quarterly), sum(r["table_disclosed"] for r in quarterly)), "",
             "## 统计口径", "",
             "识别汇金、证金及具名委托计划。金额=报告期末持有份额×同期单位净值/1亿。全部为报告期末快照，不是每日数据。",
             "未入榜、未披露、未成立和未检索到报告分开处理。只有当期已成立样本均具备持有人表且识别出国家队账户时才汇总，缺失不补零、不沿用旧份额。",
             "金额同时受净值和持有份额变化影响，差额不能直接认定为净买卖。基金样本随成立日期扩充，可用页面的2015年已成立样本或单基金查看。",
             "直接A股仍仅有先前核验的两期数据，本次历史回溯只针对ETF。", "", "## 各期覆盖", "",
             "| 报告期 | 已成立样本 | 具名表 | 识别出国家队 | 已识别金额/亿元 |", "| --- | ---: | ---: | ---: | ---: |"]
    for s in summaries:
        lines.append("| %s | %s | %s | %s | %s |" % (s["period"], s["eligible"], s["disclosed"], s["identified"],
                     "%.2f" % s["amount"] if s["amount"] is not None else "无法核实"))
    lines += ["", "## 报告索引", "", "逐条份额、净值、持有人原文摘录及文本SHA256保存在 `work/national_team_etf_history.json`。", "",
              "| 基金 | 报告期 | 类型 | 状态 | 原文 |", "| --- | --- | --- | --- | --- |"]
    for r in result["reports"]:
        lines.append("| %s | %s | %s | %s | [报告](%s) |" % (r["code"], r["period"], r["kind"], r["status"], r["source"]))
    (ROOT / "outputs/national-team-etf-history-audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Exported", len(rows), "reports;", len(periods), "quarter ends;", len([s for s in summaries if s["amount"] is not None]), "valued periods", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", default=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y%m%d"))
    parser.add_argument("--codes", nargs="*", default=list(FUNDS))
    parser.add_argument("--refresh-listings", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    args = parser.parse_args()
    if args.export_only:
        export_history(args.as_of)
        return
    # Bound public endpoint traffic; cache each response for interrupted runs.
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda code: collect(args.as_of, [code], args.refresh_listings), args.codes))
    rows = [r for result, _ in results for r in result]
    failures = [r for _, errors in results for r in errors]
    save(CACHE / "audit-draft.json", {"checked_at": args.as_of, "reports": rows, "failures": failures})
    print("Reports", len(rows), "failures", len(failures), dict(Counter(r["status"] for r in rows)))
    if set(args.codes) == set(FUNDS):
        export_history(args.as_of)


if __name__ == "__main__":
    main()
