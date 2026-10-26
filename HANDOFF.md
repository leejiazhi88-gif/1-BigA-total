# 1-BigA-total 换机与部署说明

这个文档记录本项目在不同电脑之间继续迭代、同步代码、查看线上页面时需要的信息。

## 仓库地址

- GitHub 仓库：https://github.com/leejiazhi88-gif/1-BigA-total
- Git 远端（SSH）：`git@github.com:leejiazhi88-gif/1-BigA-total.git`
- 线上页面：https://leejiazhi88-gif.github.io/1-BigA-total/

仓库于2026-10-13改名为 `1-BigA-total`。GitHub仓库旧链接会跳转，但GitHub Pages旧路径不会自动跳转，请更新收藏夹与分享链接。

## 本机常用路径

当前这台电脑上的项目目录：

```text
/Users/fuguiplus/Documents/Codex/2026-06-08/bili-atotal/work/BigA-total
```

本机目录保留原名 `BigA-total`，Git远端已连接新仓库名；目录名称不影响同步或部署。

主要页面文件：

```text
index.html
outputs/a_share_20y_dashboard.html
```

## 换一台电脑继续开发

首次使用时克隆仓库：

```bash
git clone https://github.com/leejiazhi88-gif/1-BigA-total.git
cd 1-BigA-total
```

已在其他电脑克隆旧仓库的，在原项目目录执行一次以下命令更新远端：

```bash
git remote set-url origin https://github.com/leejiazhi88-gif/1-BigA-total.git
git fetch origin
```

使用SSH认证的电脑可改用上面的SSH地址；原有提交历史保留。

每次开始工作前先同步远端最新代码：

```bash
git pull --rebase
```

修改完成后提交并推送：

```bash
git status
git add .
git commit -m "描述这次修改"
git push
```

推送完成后，GitHub Pages 会自动更新线上页面。线上缓存可能需要等待几分钟。

## 本地运行

生成页面：

```bash
node ./work/build_market_dashboard.js
```

本地预览：

```bash
node ./work/preview_server.js
```

然后打开：

```text
http://127.0.0.1:9876
```

注意：`127.0.0.1:9876` 只是当前电脑的本地预览地址，电脑关机或预览服务停止后就不能访问。真正的线上地址是：

```text
https://leejiazhi88-gif.github.io/1-BigA-total/
```

## GitHub 登录

如果新电脑第一次执行 `git push` 时提示无法读取用户名或密码，需要先完成 GitHub 认证。推荐使用 GitHub CLI：

```bash
gh auth login
```

如果没有安装 `gh`，也可以继续使用 HTTPS 推送时弹出的 GitHub 登录/token 流程。macOS 通常会把凭据保存到钥匙串。

## 数据与运行注意事项

- 项目会使用 Python 脚本拉取部分估值与情绪数据。
- 如果设置了 `CODEX_PYTHON` 或 `PYTHON`，生成脚本会优先使用它们。
- 如果没有设置，会自动尝试 `python3` 和 `python`。
- Tushare 部分接口可能需要账号权限；权限不足时，脚本会尽量使用已有缓存数据。
- 如果外部行情接口临时断开，可以稍后重试生成命令。

## 刷新与验收

`node work/build_market_dashboard.js` 会按北京时间当天作为查询上限，逐个刷新数据模块，再将数据和 ECharts 内嵌进两份 HTML。某个模块失败会保留该模块缓存并打印名称，其余模块继续刷新。各图的最新读数标明实际数据日期；收盘后数据源尚未发布的交易日不会填入假数据。

Tushare 凭据优先读取环境变量 `TUSHARE_TOKEN`，兼容本机 Codex 配置中的已有凭据。脚本使用 Python 3.9+ 标准库通过 HTTPS 请求接口，不依赖 tushare Python 包；不要将 token 写入仓库。

只用已下载的数据重新生成页面：

```bash
node work/build_market_dashboard.js --skip-refresh
```

限定查询上限（不指定时自动取今天）：

```bash
MARKET_END_DATE=20261023 node work/build_market_dashboard.js
```

数据口径检查：

```bash
python3 -m unittest discover -s work -p 'test_*.py'
```

发布时需提交源脚本、数据 JSON、`index.html` 和 `outputs/a_share_20y_dashboard.html`。推送后检查 GitHub Pages 实际页面，确认曲线和日期已更新；只推送源代码不会在 Pages 自动运行 Python 拉数据。

本地 HTTP 与直接打开 HTML 使用同一份内嵌数据。总览从上到下依次为指数价格、交易规模、市盈率、过去12个月合计利润。“交易规模”固定显示沪深 A 股合计，成交量用亿股、成交额用亿元，跟随总览时间范围缩放。

价格和估值按各自实际发布日期更新。`market_overview_data.json` 的 `prices` 保存独立行情序列，`sh`/`sz` 保留同日PE及利润序列；`meta.priceEnd` 和 `meta.valuationEnd` 分别标记截止日期。总览价格、交易规模不再等待估值接口；PE、利润及历史分位不会把上一交易日的数据标为今天，卡片逐项显示数据日期。

### 2026-10-26 国家队直接持仓图表

ETF历史金额已合并到主图，下方“ETF报告核查与来源”默认折叠，保留基金、报告期和报告类型筛选，不再重复绘制金额曲线。展开默认只列中报/年报；季报及全部报告可切换查看。旧链接 `#national-team-etf-history` 会自动展开。14只候选基金从2015-06-30回溯，核查794份报告（525份季报、269份中报/年报），产生22个有金额的半年末/年末时点。525份季报均未列具名持有人表；2026年中报14只均缺表，2026年三季报暂未在所查公告列表检索到，不能补零或续用旧份额。167条已识别基金/报告期记录的净值与独立Tushare基金净值数据全部核对一致。

历史文件：`work/national_team_etf_history.json`、`work/fetch_national_team_etf_history.py`、`work/national_team_etf_history.js`；核查索引见 `outputs/national-team-etf-history-audit.md`。脚本使用公开报告与PDF，依赖 `pypdf`，不需要Tushare凭据；可用 `python3 work/fetch_national_team_etf_history.py --refresh-listings` 单独刷新，随后执行 `node work/build_market_dashboard.js --skip-refresh`。完整命令与断点续跑说明见README。

2015-06-30仅8只候选基金已成立，2015年末9只，2022年三季度后14只。页面允许查看2015年已成立的固定8只或单只基金，避免把扩充样本当作同一范围的增持。缺失与榜内未发现保留区别，未达到具名表覆盖条件的时期不汇总。

国家队章节顶部展示直接A股、ETF样本及以上可识别金额合计，主图按报告期展示金额，单位亿元。ETF历史同时接入这张主图、报告期选择、金额卡片、覆盖表及明细；更新数据时须同时核验主图和报告核查区。两条主曲线可单独勾选，纵轴随可见曲线和时间缩放调整；可展开汇金投资、其他已识别账户的A股构成。按报告期查看股票/ETF明细、搜索名称或代码，并打开来源。

主图由 `work/national_team_direct_holdings.js` 合并 `outputs/national-team-holdings-comparison-20261026.json`、`work/national_team_stock_history.json` 与 `work/national_team_etf_history.json`，校验股数、价格、汇总、覆盖数量及重叠时期金额后内嵌入HTML。2015-06-30至2026-06-30共有45个季度，45期有直接A股金额，22期有ETF金额及同日合计。ETF季报没有具名表，曲线仅绘制中报/年报时点；不能续用半年末份额填季度空值。2026年中报ETF缺口与无法合计状态必须保留。2025年底默认展示直接A股41,580.57亿元、ETF样本14,749.06亿元、合计56,329.63亿元；不表示国家队全部资产。主图报告期选择器值为 `YYYYMMDD`，系列数据用 `[日期,金额]`，点击和提示必须按日期查找，不能因股票/ETF点数不同而使用相同数组下标。

直接A股历史脚本为 `work/fetch_national_team_stock_history.py`，依次执行 `--stage collect`、`--stage audit`、`--stage export`；日期与断点缓存说明见README。以明确的前十大股东表为准，避免Tushare早期混入流通股东表；排除B股副本、上市前、退市后及转融通担保账户。`work/national_team_stock_adjustments.json` 保留45期建行原报告A/H拆分证据，不能将H股乘A股价格。股数双源一致数量、停牌期末参考价数量及源数据差异记录在每期JSON和 `outputs/national-team-stock-history-audit.md`。未知股份类别、缺价或期末价格冲突须先处理，不能略过后发布总额。

普通行情刷新不重新估算此报告快照。增加报告期应先核对每份ETF持有人表，以及股票股东A/H股份类别，保持报告期、公布日期、金额和覆盖范围各自准确。不能由总份额申赎、底层股票暴露或旧份额乘新净值反推新的国家队持仓。

验证命令：

```bash
node --test work/test_national_team_direct_holdings.cjs
python3 -m unittest discover -s work -p 'test_*.py'
node work/build_market_dashboard.js --skip-refresh
```

原有每日ETF申赎和底层暴露、聚类保留为辅助观察。此次更新图表，行情数据仍沿用10月23日刷新记录中的实际截止日期。

### 2026-10-23 收盘刷新记录

刷新前执行 `git fetch` 与 `git pull --ff-only`，远端没有新提交，起点为 `64ab594`。本次查询上限为2026-10-23，各指标按实际发布日期展示。

| 数据 | 最新可用日期 / 报告期 |
| --- | --- |
| 上证、深证收盘价；沪深A股成交量与成交额 | 2026-10-23 |
| 两市成交额、换手率（散户情绪） | 2026-10-23 |
| PE、利润、PE/PB历史分位、股债收益差 | 2026-10-22，今日估值尚未发布 |
| 融资余额及占比、涨停数量 | 2026-10-22，今日数据尚未发布 |
| 大宗交易、机构大宗净买入 | 2026-10-22，按本周已发布交易汇总 |
| 股东增减持公告、IPO、Shibor代理利率 | 2026-10-23 |
| 社融、M2 | 2026年9月 |
| 宽基ETF每日净申购估算 | 2026-06-10至2026-10-22，共90个完整交易日 |
| 国家队ETF底层披露暴露 | 2026-06-30报告期，12只ETF；长期23个披露时点 |
| 北向净流入历史口径 | 截止2024-08-16，披露停止后不续填 |

10月23日上证收盘3690.4753点、深证11673.8259点；总览沪深A股成交量1242.2118亿股、成交额19554.8773亿元。散户模块的两市成交额来自 `daily_info`，与总览A股指数成交口径不同，保留各自来源。

散户周频数据按每个指标最后一次有效观测取值，发布日期不同可保留两个不同日期的点；不把融资或涨停旧值挪到今天。大宗交易与股东公告使用各自观测日期，当前周已重新核对。ETF窗口以最新已发布的份额日期结束，内部缺失仍留空；不会仅因今天尚未发布而把所有最新读数显示为空。

### 2026-10-12 刷新记录（截止上周五 2026-10-09）

| 数据 | 最新可用日期 / 报告期 |
| --- | --- |
| 总览价格、利润、PE、交易量与交易额 | 2026-10-09 |
| PB、PE/PB历史分位、散户情绪、大宗交易 | 2026-10-09 |
| 产业资本公告、IPO、Shibor代理利率 | 2026-10-09；各图按实际日期显示 |
| 社融、M2 | 2026年8月 |
| 宽基ETF每日净申购估算 | 9只基金；2026-05-28 至 2026-10-09，90个交易日 |
| 国家队ETF底层披露暴露 | 2026-06-30半年报；12只ETF，1,835只底层股票 |
| 长期底层披露暴露 | 上证50ETF、沪深300ETF；2015年以来23个半年报/年报时点 |
| 股债收益差 | 2026-10-09；中债官方10年期到期收益率为1.6864% |
| 北向净流入历史口径 | 截止2024-08-16，此后停止披露，不续填 |

`yc_cb` 权限仍不足，现由中债官方公开曲线补齐新日期。请求校验曲线名称、日期和10年期限；失败留空，下一次刷新重试。不会用旧利率计算新日期的收益差，不影响PE、PE分位、PB。

日线公式为 `(当日总份额－前一交易日总份额) × 当日单位净值 / 10000`，份额原单位万份、输出亿元。它包含所有投资者及实物申赎，不能辨别国家队。页面可选30/60/90交易日及指数类别；累计从区间首日重算，缺失或疑似份额拆分不填零、不跨日补算。

长期暴露改为使用两只ETF各期全部可得披露A股，保留原披露权重，展示有效覆盖权重；只使用截止日前公告和对应报告期最新修订。未识别的股票股东信息保留缺失，不冒充零持仓。它是已识别底层股票贡献，不是国家队总资产或救市金额。

大宗交易与股东增减持现在分页获取，避免接口条数上限截断；Shibor采用周内最后观测。融资指标仅合计两市同日数据，不把旧余额/融资买入额搬到新日期。宏观数据与持仓报告依公布频率更新，页面静态事件列表也不代表实时新闻流。

## Codex 协作约定

后续每完成一步，请在最后给出：

- 最新本地文件路径
- 可验收的线上 URL
- 当前 git 状态或需要人工确认的点
