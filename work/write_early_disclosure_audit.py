"""Document early disclosed-holding coverage and the CCB share-class audit."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
CACHE = ROOT / ".tools/national-team-stock-history"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    stocks = read(WORK / "national_team_stock_history.json")
    social = {row["period"]: row for row in read(WORK / "social_security_history.json")["snapshots"]}
    corrections = read(WORK / "national_team_stock_adjustments.json")
    periods = sorted(set(p for p in stocks["stocks"] if p < "20150000") | set(stocks["gaps"]))
    lines = ["# 2010—2014年国家队与社保已披露持仓核查", "",
             "此表是公开前十大股东榜单中可识别的持仓，不是机构总仓位，更不是净买卖额。金额按报告期末A股股数乘当日未复权价格估算；持股变化、估值和榜单覆盖变化都会改变曲线。",
             "", "## 早期覆盖", "",
             "早期仅在Tushare股东榜覆盖至少2,000家公司、且东方财富社保主榜单至少100条原始记录时展示。阈值用于排除明显缺页的报告期，不保证剩余期完整。缺口保留为空，不补零、不沿用上期值。",
             "", "| 报告期 | Tushare股东榜公司 | 东方财富社保原始条数 | 国家队A股/亿元 | 社保A股/亿元 | 状态 |",
             "| --- | ---: | ---: | ---: | ---: | --- |"]
    for period in periods:
        screened = CACHE / f"screened-{period}.json"
        national_count = read(screened)["source_companies"] if screened.exists() else None
        social_file = CACHE / f"social-screened-{period}.json"
        social_count = read(social_file)["coverage"]["primary_rows"] if social_file.exists() else None
        national = stocks["stocks"].get(period)
        soc = social.get(period)
        status = "已核实样本" if national and soc else "源覆盖不足或记录冲突，图上留空"
        lines.append(f'| {period} | {national_count if national_count is not None else "未核实"} | '
                     f'{social_count if social_count is not None else "未核实"} | '
                     f'{national["total_yi"]:,.2f} | {soc["amount"]:,.2f} | {status} |' if national and soc else
                     f'| {period} | {national_count if national_count is not None else "未核实"} | '
                     f'{social_count if social_count is not None else "未核实"} | — | — | {status} |')
    lines += ["", "## 建行汇金A/H股拆分", "",
              "东方财富部分早期股东榜将建行汇金A/H股合并为一条。逐期对照建行原报告，只有A股数加H股数与榜单总股数完全一致才纳入A股曲线；H股绝不按A股价格估值。2010年6月与2012年一季度的镜像PDF文本提取有错位，使用建行原始披露复核。",
              "", "| 报告期 | 汇金建行A股 | 汇金建行H股 | 原报告 |",
              "| --- | ---: | ---: | --- |"]
    for period in periods:
        key = period + ":601939.SH:中央汇金投资有限责任公司"
        row = corrections.get(key)
        if row:
            lines.append(f'| {period} | {row["a_shares"]:,} | {row["h_shares"]:,} | [查看报告]({row["pdf"]}) |')
    lines += ["", "[国家队逐笔数据](../work/national_team_stock_history.json) · [社保逐笔数据](../work/social_security_history.json) · [拆分证据](../work/national_team_stock_adjustments.json)", ""]
    (ROOT / "outputs/early-disclosed-holdings-audit.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
