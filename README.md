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
- 国家队观察：9只宽基ETF每日净申购估算、2015年以来长期底层股票披露暴露、12只ETF持仓聚类

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
