# A股大顶研究仪表盘

- 线上页面：https://leejiazhi88-gif.github.io/1-BigA-total/
- GitHub仓库：https://github.com/leejiazhi88-gif/1-BigA-total

这个仓库用于生成 A 股大顶研究的本地 HTML 仪表盘，目前包含：

- 总览：依次展示指数价格、沪深A股交易规模（交易量与交易额）、PE(TTM)、过去12个月合计利润
- 估值模块：PE(TTM)、PE历史分位、PB可得历史分位、股债收益差
- 估值事件 List：按年份和季度切换查看典型估值事件
- 情绪-散户模块：两市成交额与换手率回溯至2006年，融资指标至2010年业务启动，非ST涨停数量至2020年；提供3/5/10/20年及全部范围
- 散户情绪事件 List：按年份和季度切换查看开户、基金、融资监管与极端情绪事件
- 情绪-大资金模块：沪深A股大宗交易、机构席位大宗净买入、产业资本增减持、北向资金历史口径
- 情绪-官方模块：IPO融资、产业资本净减持、印花税率、政策利率、社融/M2与政策事件
- 国家队持仓：汇金／证金直接A股与ETF、社保投资组合独立曲线，支持金额／持仓比例切换、报告期走势、账户构成及逐条持仓来源；下方保留9只ETF每日净申购和长期底层股票暴露作为辅助观察，已移除聚类散点图及配套明细

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
- `outputs/retail-history-audit.md`：散户情绪20年回溯的覆盖范围、汇总核对及数据限制
- `work/fetch_large_money_sentiment_data.py`：大资金连续数据更新脚本
- `work/add_large_money_sentiment_module.js`：大资金模块注入脚本
- `outputs/block-trade-audit.md`：大宗交易异常尖峰原因、数据核查及修复口径
- `outputs/block-trade-audit.json`：大宗交易证券范围、逐周汇总及校验结果
- `work/block_trade_adjustments.json`：有独立来源依据的逐笔数据修正
- `work/fetch_official_sentiment_data.py`：官方情绪连续数据更新脚本
- `work/add_official_sentiment_module.js`：官方情绪模块注入脚本
- `work/fetch_national_team_etf_data.py`：国家队 ETF 底层暴露数据更新脚本
- `work/add_national_team_etf_module.js`：国家队 ETF 暴露模块注入脚本
- `work/national_team_direct_holdings.js`：直接A股与ETF金额、缺失状态校验及页面交互
- `work/holding_ratios.js`：持仓比例、去重分母与明细计算
- `work/holding_denominators.json`：逐报告期A股股本、ETF总份额与原始来源
- `work/fetch_holding_denominators.py`：历史股本获取、原始ETF报告分母提取与核验
- `work/holding_capital_adjustments.json`：H股退市后的非上市外资股分类修正及原报告证据
- `outputs/holding-ratio-audit.md`：持仓比例公式、样本范围、核查记录与更新方法
- `work/social_security_history.json`：2015年6月至2026年6月45个季度的社保组合A股金额与逐条明细
- `work/fetch_social_security_history.py`：社保账户识别、历史取数及双源核对
- `outputs/social-security-history-audit.md`：社保统计范围、各期覆盖和来源限制
- `work/fetch_national_team_stock_history.py`：直接A股季度回溯、股东表交叉核查与导出脚本
- `work/national_team_stock_history.json`：2015年6月至2026年6月45个季度的直接A股持仓、来源差异及覆盖数量
- `work/national_team_stock_adjustments.json`：建行各期A/H股拆分、原报告链接及证据
- `outputs/national-team-stock-history-audit.md`：直接A股逐季汇总与口径核查
- `outputs/national-team-holdings-comparison-20261026.json`：2026-10-26逐项核验的直接持仓快照与来源，主图的数据依据
- `work/fetch_national_team_etf_history.py`：2015年6月以来14只ETF定期报告核查，可从原始PDF恢复历史具名持有人
- `work/national_team_etf_history.json`：794份报告的来源、持有份额、净值及披露状态
- `work/national_team_etf_history.js`：ETF历史数据校验与可折叠的报告核查明细，保留基金筛选和原文来源
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

散户情绪的成交额和换手率覆盖2006年以来：沪市汇总表仅从2019年开始，早期由沪市A/B股分项加总；深市使用全市场汇总。该模块股票口径含B股，因此成交额与总览纯A股口径略有差异。换手率全时段统一采用沪市主板A股、B股、科创板及深市的流通市值加权，替代之前的交易所层级加权。融资余额、融资余额/流通市值从2010-03-31开始（周频首点2010-04-02），更早年份不适用；非ST涨停源从2020年开始，不推算更早值。每周取各指标最后可得交易日的值，保留实际日期，不累计、不跨周补值。详见[回溯核查](outputs/retail-history-audit.md)。

单独更新散户情绪历史（默认从2006年到当前日期，也可用 `MARKET_END_DATE` 指定截止日）：

```bash
python3 work/fetch_retail_sentiment_data.py
python3 -m unittest discover -s work -p 'test_*.py'
node work/build_market_dashboard.js --skip-refresh
```

已结束年份和月份的原始响应缓存在 `.tools/retail-history/`，支持断点重跑；当前年市场及融资数据、当前月涨停数据每次重新拉取。重新核查历史修订时可清除相应缓存后重跑。换电脑时使用已提交的 `retail_sentiment_data.json` 即可构建，不必先重新下载全部数据。

大宗交易和机构大宗净买入从2018年开始，统一仅统计沪深A股，包含后来退市的股票，排除债券、基金、B股和北交所。Tushare股票成交金额为万元，除以10,000换成亿元；逐笔核对成交价与成交量，按实际交易周汇总。机构净买入为“机构专用”买入额减卖出额，双方均为机构的交易净额为零。图表保留真实大额交易，纵轴随可见时间区间调整。2026-10-27已修复旧版混入债券及单位不一致导致的异常尖峰，详见[核查记录](outputs/block-trade-audit.md)。

仅重算大宗交易两项指标（截止日须与已有 `large_money_sentiment_data.json` 的 `meta.end` 相同）：

```bash
MARKET_END_DATE=20261023 python3 work/fetch_large_money_sentiment_data.py --blocks-only
python3 -m unittest discover -s work -p 'test_*.py'
node work/build_market_dashboard.js --skip-refresh
```

去掉 `--blocks-only` 可刷新整个大资金模块。历史月份响应缓存在不入库的 `.tools/large-money-blocks/`，查询截止日所在月份每次重新获取；重新核查历史修订时移走对应缓存再运行。未核实的A股身份或价量金额差异会阻止替换正式数据。换电脑使用已提交的JSON可直接构建页面。

国家队直接持仓主图覆盖2015-06-30至2026-06-30的45个季度，每期均有直接A股金额；ETF有22个中报/年报金额点。报告期选择、金额卡片、覆盖表和明细使用同一份合并数据。默认概览为双方都有可识别金额的2025年底：直接A股41,580.57亿元、14只ETF样本可识别持仓14,749.06亿元。ETF季报及2026年中报缺少具名持有人表，ETF及两类资产合计保留空值，不沿用上期份额。金额变化包含价格和披露覆盖变化，不能作为净买卖额。点击数据点或切换报告期可查看对应明细；曲线可单独勾选、拖动时间范围，纵轴按可见区间及曲线调整。

图表右上角提供“金额／持仓比例”切换，曲线、纵轴、卡片和明细同步更新，保留已选曲线和时间范围。比例分母是当期实际识别到持仓的标的，不是全市场：A股用对应公司的A股总股本乘同期参考价，ETF用已识别持有基金的总份额乘同期净值，标的只计一次；社保单独使用其持有公司范围。2025年末汇金／证金A股为13.09%（220家公司）、ETF为81.03%（12只识别到持仓的基金）、社保为1.26%（521家公司）。股票与ETF比例不相加。比例可以减少整体价格同幅涨跌的影响，但仍受各标的相对涨跌、增发和披露样本变化影响，不能视为净买入。公式、分母证据及重跑命令见[持仓比例核查](outputs/holding-ratio-audit.md)。换电脑使用已提交的分母JSON可直接构建；增加持仓报告期或公司后必须同步补充分母，缺失时构建报错，不能用当下股本替代历史股本。

社保投资组合A股作为绿色独立曲线，覆盖同一45个季度，附金额卡片、逐期公司数、可搜索的持仓明细及来源。2026年6月末已识别574家公司、714条持仓，金额2,118.46亿元；2025年末1,948.76亿元。识别“全国社保基金××组合”及明确具名的社保委托组合；不含社保理事会直持、转持/划转、基本养老保险、ETF和榜外持仓。社保金额不计入原有汇金／证金合计，也不代表社保全部资产。统一使用前十大股东表，数字编号规范化后按股票和组合去重，按期末A股未复权参考价估值；来源差异保留在JSON中。

单独回溯或更新社保（普通行情刷新复用已提交的报告快照）：

```bash
python3 work/fetch_social_security_history.py --start 20150630 --end 20260630 --as-of 20261027
python3 -m unittest discover -s work -p 'test_*.py'
node --test work/test_national_team_direct_holdings.cjs work/test_national_team_etf_history.cjs
node work/build_market_dashboard.js --skip-refresh
```

脚本复用 `.tools/national-team-stock-history/` 中的全市场股东与期末行情缓存，新增的 `social-primary-*` 保存东方财富分类检索及名称补充检索的分页响应，支持中断重跑。重新核查历史修订时先移走相应报告期缓存；换电脑直接使用已提交的JSON即可构建。新增日期需与主图报告期同步，缺失不补零；未知股份类别、价格冲突、缺价和重复持仓会阻止发布。

上述直接持仓是独立核验的报告快照，普通行情刷新不会将旧份额滚动估值成新报告期持仓，也不会自动把底层暴露替换为直接持仓。主图由 `national_team_direct_holdings.js` 合并持仓对比JSON、`national_team_stock_history.json` 与 `national_team_etf_history.json`，重叠时期的金额与披露状态须通过校验。A股统一采用东方财富前十大股东表，Tushare用于股数及价格交叉核对；早期接口中混入的前十大流通股东不并入。只保留当期已上市、未退市的A股，建行逐期拆分A/H股。停牌等缺少期末行情时用数据源期末参考市值折算价，明细标＊。完整限制和差异见股票历史核查文件。

直接A股历史单独刷新（使用已有Tushare配置，原始分页缓存不入库）：

```bash
python3 work/fetch_national_team_stock_history.py --stage collect
python3 work/fetch_national_team_stock_history.py --stage audit
python3 work/fetch_national_team_stock_history.py --stage export
python3 -m unittest discover -s work -p 'test_*.py'
node --test work/test_national_team_direct_holdings.cjs work/test_national_team_etf_history.cjs
node work/build_market_dashboard.js --skip-refresh
```

默认查询2015-06-30至2026-06-30、截至2026-10-26公布的数据。可用 `--start YYYYMMDD --end YYYYMMDD --as-of YYYYMMDD` 指定范围。三个阶段使用相同日期参数，断点重跑会复用 `.tools/national-team-stock-history/`。换电脑后已有JSON可直接构建，无需重新拉取。新增报告期的A/H股拆分必须先补充有原报告证据的调整文件；未知股份类别、缺价、价格冲突会阻止导出，不能推算补齐。

ETF历史金额统一显示在国家队直接持仓主图，回溯至2015-06-30，不再另设重复曲线。下方“ETF报告核查与来源”默认折叠，展开后默认列出中报/年报，可切换季报或全部报告；旧链接 `#national-team-etf-history` 会自动展开核查区。2026-10-26核查794份定期报告，其中525份季报均未提供具名持有人表；22个中报/年报时点可汇总金额，截止2025-12-31。2026年中报保留缺口，2026年三季报在所查公告列表暂未检索到。可切换全部样本、2015年已成立的8只样本或单只基金；每期列出报告原文、公布日期与份额。基金尚未成立、榜内未发现、未列具名表、未检索到报告分别显示，均不当作零持仓。

独立更新这份历史核查数据（Python需要 `pypdf`；不需要Tushare凭据）：

```bash
python3 -m pip install pypdf
python3 work/fetch_national_team_etf_history.py --refresh-listings
python3 -m unittest discover -s work -p 'test_*.py'
node --test work/test_national_team_direct_holdings.cjs work/test_national_team_etf_history.cjs
node work/build_market_dashboard.js --skip-refresh
```

下载中断可重新运行，原始报告缓存在不入库的 `.tools/national-team-history/`。只有下载与解析问题全部解决、并通过2025年末已审计金额对账后才输出正式JSON。`--export-only --as-of 20261026` 可只用本地报告缓存重新解析。普通行情刷新不会反复下载这些历史报告。
