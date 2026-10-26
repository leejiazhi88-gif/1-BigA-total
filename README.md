# A股大顶研究仪表盘

- 线上页面：https://leejiazhi88-gif.github.io/1-BigA-total/
- GitHub仓库：https://github.com/leejiazhi88-gif/1-BigA-total

这个仓库用于生成 A 股大顶研究的本地 HTML 仪表盘，目前包含：

- 总览：依次展示指数价格、沪深A股交易规模（交易量与交易额）、PE(TTM)、过去12个月合计利润
- 估值模块：PE(TTM)、PE历史分位、PB可得历史分位、股债收益差
- 估值事件 List：按年份和季度切换查看典型估值事件
- 情绪-散户模块：两市成交额、换手率、融资余额、融资余额/流通市值、涨停数量
- 散户情绪事件 List：按年份和季度切换查看开户、基金、融资监管与极端情绪事件
- 情绪-大资金模块：大宗交易、机构席位大宗净买入、产业资本增减持、北向资金历史口径
- 情绪-官方模块：IPO融资、产业资本净减持、印花税率、政策利率、社融/M2与政策事件
- 国家队持仓：直接A股与ETF已披露金额、报告期走势、账户构成、逐条持仓来源；下方保留9只ETF每日净申购、长期底层股票暴露与聚类作为辅助观察

换机同步、线上地址、部署与本地运行说明见 [HANDOFF.md](HANDOFF.md)。
国家队 ETF 暴露聚类的候选基金池、统计公式与数据限制见 [NATIONAL_TEAM_ETF_CLUSTER.md](NATIONAL_TEAM_ETF_CLUSTER.md)。

## 运行

生成页面：

```powershell
node ./work/build_market_dashboard.js
```

本地预览：

```powershell
node ./work/preview_server.js
```

然后打开：

```text
http://127.0.0.1:9876
```

## 主要文件

- `outputs/a_share_20y_dashboard.html`：生成后的仪表盘
- `work/build_market_dashboard.js`：总览生成入口
- `work/fetch_market_overview_data.py`：总览价格、PE(TTM)、过去12个月合计利润数据更新脚本
- `work/market_overview_data.json`：总览数据缓存
- `work/add_valuation_module.js`：估值模块注入脚本
- `work/fetch_valuation_data.py`：PB、股债收益差数据更新脚本
- `work/valuation_data.json`：估值扩展数据缓存
- `work/fetch_retail_sentiment_data.py`：散户情绪连续数据更新脚本
- `work/add_retail_sentiment_module.js`：散户情绪模块注入脚本
- `work/fetch_large_money_sentiment_data.py`：大资金连续数据更新脚本
- `work/add_large_money_sentiment_module.js`：大资金模块注入脚本
- `work/fetch_official_sentiment_data.py`：官方情绪连续数据更新脚本
- `work/add_official_sentiment_module.js`：官方情绪模块注入脚本
- `work/fetch_national_team_etf_data.py`：国家队 ETF 底层暴露数据更新脚本
- `work/add_national_team_etf_module.js`：国家队 ETF 暴露模块注入脚本
- `work/national_team_direct_holdings.js`：直接A股与ETF金额、缺失状态校验及页面交互
- `outputs/national-team-holdings-comparison-20261026.json`：2026-10-26逐项核验的直接持仓快照与来源，主图的数据依据
- `work/fetch_national_team_etf_history.py`：2015年6月以来14只ETF定期报告核查，可从原始PDF恢复历史具名持有人
- `work/national_team_etf_history.json`：794份报告的来源、持有份额、净值及披露状态
- `work/national_team_etf_history.js`：ETF历史金额曲线、基金筛选与季度报告核查明细
- `outputs/national-team-etf-history-audit.md`：历史覆盖与报告索引
- `outputs/national-team-holdings-comparison-20261026.md`：直接持仓核算口径、金额对比与报告链接
- `work/national_team_etf_data.json`：国家队 ETF 暴露数据缓存
- `work/fetch_etf_flow_data.py`：最近90个交易日的ETF份额与净申购估算更新脚本
- `work/etf_flow_data.json`：ETF日度净申购估算及原始份额、净值观测
- `NATIONAL_TEAM_ETF_CLUSTER.md`：国家队 ETF 底层暴露聚类方案与口径

## 数据口径

- PE(TTM)：来自指数动态市盈率历史序列
- 价格与估值按各自实际发布日期更新；收盘价、成交量/额先发布时可先显示当日行情，PE、利润和分位仍保留最新已发布估值的日期。总览读数逐项标注日期。
- 过去12个月合计利润：指数总市值 ÷ PE(TTM)，单位换算为亿元
- PB：来自 Tushare 指数每日指标
- 股债收益差：`100 / PE(TTM) - 10年期国债收益率`
- 交易规模：Tushare `index_daily` 的上证A指 `000002.SH` 与深证A指 `399107.SZ` 同日相加；成交量由手换算为亿股（除以 1,000,000），成交额由千元换算为亿元（除以 100,000）。不含B股、北交所、基金和债券，也不使用仅覆盖500只成分股的深证成指成交数据。每周展示最后交易日的单日值，不是周累计；两条曲线采用独立纵轴，随时间缩放自动适配。

注意：PE、PB和交易规模覆盖 2006 年以来。国债收益率接口权限不足时，使用中债官方公开10年期到期收益率补充；数据缺失的日期不计算收益差。ETF每日净申购估算包含所有投资者，不能等同于国家队买入额；宏观与持仓数据按实际披露频率更新。

国家队直接持仓主图目前仅包含已核实的2025-12-31和2026-06-30两期。默认概览为双方都有可识别金额的2025年底：直接A股41,580.57亿元、14只ETF样本可识别持仓14,749.06亿元。2026年中报ETF缺少具名持有人表，ETF及两类资产合计保留空值。金额变化包含价格和披露覆盖变化，不能作为净买卖额。点击报告期数据点或切换报告期可查看对应明细；曲线可单独勾选，纵轴按可见曲线调整。

上述直接持仓是独立核验的报告快照，普通行情刷新不会将旧份额滚动估值成新报告期持仓，也不会自动把底层暴露替换为直接持仓。扩展报告期须先核实具名持仓、A/H股份类别及同日价格，再更新核算文件和 `national_team_direct_holdings.js` 的数据入口。验证：`node --test work/test_national_team_direct_holdings.cjs`。

国家队章节新增“ETF具名持仓历史”，回溯至2015-06-30。2026-10-26核查794份定期报告，其中525份季报均未提供具名持有人表；22个中报/年报时点可汇总金额，截止2025-12-31。2026年中报保留缺口，2026年三季报在所查公告列表暂未检索到。可切换全部样本、2015年已成立的8只样本或单只基金；每期列出报告原文、公布日期与份额。基金尚未成立、榜内未发现、未列具名表、未检索到报告分别显示，均不当作零持仓。

独立更新这份历史核查数据（Python需要 `pypdf`；不需要Tushare凭据）：

```bash
python3 -m pip install pypdf
python3 work/fetch_national_team_etf_history.py --refresh-listings
python3 -m unittest discover -s work -p 'test_*.py'
node --test work/test_national_team_direct_holdings.cjs work/test_national_team_etf_history.cjs
node work/build_market_dashboard.js --skip-refresh
```

下载中断可重新运行，原始报告缓存在不入库的 `.tools/national-team-history/`。只有下载与解析问题全部解决、并通过2025年末已审计金额对账后才输出正式JSON。`--export-only --as-of 20261026` 可只用本地报告缓存重新解析。普通行情刷新不会反复下载这些历史报告。
