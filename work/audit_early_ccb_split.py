"""Inspect issuer reports for early Huijin A/H holdings in China Construction Bank."""

import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".tools" / "early-ccb-reports"
PERIODS = [f"{year}{suffix}" for year in range(2010, 2015)
           for suffix in ("0331", "0630", "0930", "1231") if f"{year}{suffix}" >= "20100630" and f"{year}{suffix}" != "20100930"]


def listing():
    rows = []
    for page in range(1, 10):
        params = {"sr": -1, "page_size": 100, "page_index": page, "ann_type": "A",
                  "client_source": "web", "stock_list": "601939", "f_node": 0,
                  "begin_time": "2010-01-01", "end_time": "2016-01-01"}
        url = "https://np-anotice-stock.eastmoney.com/api/security/ann?" + urllib.parse.urlencode(params)
        payload = json.load(urllib.request.urlopen(url, timeout=30))
        rows.extend(payload["data"]["list"])
        if len(rows) >= payload["data"]["total_hits"]:
            break
    return rows


def pdf_text(code):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / (code + ".txt")
    if target.exists():
        return target.read_text(encoding="utf-8")
    url = f"https://pdf.dfcfw.com/pdf/H2_{code}_1.pdf"
    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40).read()
    reader = PdfReader(io.BytesIO(data))
    pages = min(145, len(reader.pages))
    text = "\n".join(page.extract_text() or "" for page in reader.pages[:pages])
    target.write_text(text, encoding="utf-8")
    return text


def main():
    rows = listing()
    target = ROOT / "work" / "national_team_stock_adjustments.json"
    adjustments = json.loads(target.read_text(encoding="utf-8"))
    for period in PERIODS:
        year, suffix = period[:4], period[4:]
        labels = {"0331": ("第一季度报告", "第一季度季报"),
                  "0630": ("半年度报告", "半年报"),
                  "0930": ("第三季度报告", "第三季度季报"),
                  "1231": ("年度报告", "年报")}[suffix]
        options = [row for row in rows if year + "年" in row["title"] and any(label in row["title"] for label in labels)
                   and not any(word in row["title"] for word in ("摘要", "审计", "内部控制", "补充"))]
        options.sort(key=lambda r: ("A股" not in r["title"], "H股" in r["title"], len(r["title"])))
        if not options:
            print(period, "NO_REPORT", flush=True)
            continue
        raw = json.loads((ROOT / ".tools" / "national-team-stock-history" / f"share-class-{period}.json").read_text(encoding="utf-8"))
        matched = [r for r in raw if r["SECUCODE"] == "601939.SH" and "汇金" in r["HOLDER_NAME"]
                   and "H" in (r["SHARES_TYPE"] or "")]
        if len(matched) != 1:
            print(period, "NO_MIXED_HOLDING", len(matched), flush=True)
            continue
        key = period + ":601939.SH:中央汇金投资有限责任公司"
        if period == "20100630":
            a_shares, h_shares = 144747455, 133262144534
            if a_shares + h_shares != matched[0]["HOLD_NUM"]:
                raise ValueError("2010 interim issuer report does not reconcile to shareholder table")
            source = "https://www.ccb.com/cn/investor/20100822_1282487720/2010IRSummary.pdf"
            adjustments[key] = {"a_shares": a_shares, "h_shares": h_shares,
                                "source": source, "pdf": source,
                                "evidence": "建行2010年半年度报告前十名股东表：汇金H股133,262,144,534股、A股144,747,455股；与东方财富股东榜合计一致。"}
            print(period, a_shares, h_shares, "CCB_ISSUER_PDF_VERIFIED", flush=True)
            continue
        if period == "20120331":
            a_shares, h_shares = 268049398, 142590494651
            if a_shares + h_shares != matched[0]["HOLD_NUM"]:
                raise ValueError("2012 Q1 issuer report does not reconcile to shareholder table")
            source = "https://www.ccb.com/cn/investor/20120427_1335528050/A2012.pdf"
            adjustments[key] = {"a_shares": a_shares, "h_shares": h_shares,
                                "source": source, "pdf": source,
                                "evidence": "建行2012年第一季度报告前十名股东表：汇金H股142,590,494,651股、A股268,049,398股；与东方财富股东榜合计一致。"}
            print(period, a_shares, h_shares, "CCB_ISSUER_PDF_VERIFIED", flush=True)
            continue
        for row in options:
            try:
                text = pdf_text(row["art_code"])
                for match in re.finditer(r"142,590,494,651\s*[（(]?\s*H\s*股", text):
                    excerpt = text[max(0, match.start() - 160):match.end() + 180]
                    a_match = re.search(r"H\s*股.{0,160}?([0-9]{1,3}(?:,[0-9]{3})+)\s*[（(]?\s*A\s*股", excerpt, re.S)
                    if not a_match:
                        continue
                    a_shares, h_shares = int(a_match[1].replace(",", "")), 142590494651
                    if a_shares + h_shares != matched[0]["HOLD_NUM"]:
                        continue
                    adjustments[key] = {"a_shares": a_shares, "h_shares": h_shares,
                                        "source": "https://data.eastmoney.com/notices/detail/601939/" + row["art_code"] + ".html",
                                        "pdf": "https://pdf.dfcfw.com/pdf/H2_" + row["art_code"] + "_1.pdf",
                                        "evidence": re.sub(r"\s+", " ", excerpt)}
                    print(period, a_shares, h_shares, row["art_code"], "VERIFIED", flush=True)
                    break
                if key in adjustments:
                    break
            except Exception as error:
                print(period, row["art_code"], "ERROR", str(error), flush=True)
        else:
            print(period, "UNRESOLVED", flush=True)
    target.write_text(json.dumps(adjustments, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
