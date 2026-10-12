# BigA-total 换机与部署说明

这个文档记录本项目在不同电脑之间继续迭代、同步代码、查看线上页面时需要的信息。

## 仓库地址

- GitHub 仓库：https://github.com/leejiazhi88-gif/BigA-total
- 线上页面：https://leejiazhi88-gif.github.io/BigA-total/

## 本机常用路径

当前这台电脑上的项目目录：

```text
/Users/fuguiplus/Documents/Codex/2026-06-08/bili-atotal/work/BigA-total
```

主要页面文件：

```text
index.html
outputs/a_share_20y_dashboard.html
```

## 换一台电脑继续开发

首次使用时克隆仓库：

```bash
git clone https://github.com/leejiazhi88-gif/BigA-total.git
cd BigA-total
```

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
https://leejiazhi88-gif.github.io/BigA-total/
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
MARKET_END_DATE=20261009 node work/build_market_dashboard.js
```

数据口径检查：

```bash
python3 -m unittest discover -s work -p 'test_*.py'
```

发布时需提交源脚本、数据 JSON、`index.html` 和 `outputs/a_share_20y_dashboard.html`。推送后检查 GitHub Pages 实际页面，确认曲线和日期已更新；只推送源代码不会在 Pages 自动运行 Python 拉数据。

本地 HTTP 与直接打开 HTML 使用同一份内嵌数据。总览从上到下依次为指数价格、交易规模、市盈率、过去12个月合计利润。“交易规模”固定显示沪深 A 股合计，成交量用亿股、成交额用亿元，跟随总览时间范围缩放。

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
