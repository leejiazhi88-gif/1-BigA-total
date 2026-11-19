# 云端每天16:30刷新

用户指定北京时间16:30、每天一次，非交易日不刷新；未公布的数据下一交易日补查。使用 GitHub Actions 的 Ubuntu 云端机器，电脑关机、换机均不影响运行。不创建本机定时器，也不依赖 Codex 打开。

## 首次启用（仓库设置）

1. 在 [Actions secrets](https://github.com/leejiazhi88-gif/1-BigA-total/settings/secrets/actions) 点击 **New repository secret**，名称填 `TUSHARE_TOKEN`，值填现有 Tushare Token。不要写进代码、Issue 或公开日志。
2. 在 [Pages 设置](https://github.com/leejiazhi88-gif/1-BigA-total/settings/pages) 将 **Build and deployment → Source** 设为 **GitHub Actions**。保持现有网址，工作流会一起打包已有行业子页面。
3. 打开 [A-Total online refresh](https://github.com/leejiazhi88-gif/1-BigA-total/actions/workflows/daily-refresh.yml)，如提示则启用工作流，点击 **Run workflow**，选择 `main`。先完成密钥和 Pages 设置再运行。非交易日手动执行同样跳过，不会假装刷新了当日数据。

添加的代码不代表已完成这些设置或已跑通云端。只有首次运行中 `refresh` 和 `deploy` 均成功，且最后线上版本与 HTML 核对通过，才能确认取数、提交、发布整条链路可用。若只完成配置，报告为“已配置，待首次运行验证”。

## 日常行为

1. 定时表达式 `30 8 * * 1-5` 使用 UTC，对应北京时间周一至周五16:30，不受美国夏令时影响。GitHub 可能排队延迟，不能保证精确到分钟。周末不调度；工作日先只请求沪深交易日历，法定休市日跳过所有取数、构建和部署。日历为空、来源失败或沪深冲突报错，不擅自当成休市。GitHub 为判断休市仍会有一次很短的工作流记录。
2. 交易日执行已有全页增量刷新及验收，沿用3任务并发、28天近期重查和低频复查周期。昨天未到的数据会在下次普通刷新复查；不追加晚间补刷，不自动改时间。首次云端没有原始缓存，可能比以后慢，历史缓存由 Actions 保存以供下次使用，缓存丢失只增加取数、不放松校验。
3. 所有模块构建及清单验收通过后，自动提交明确列出的数据输出和根 `index.html`。不提交原始缓存、凭据，不修改行业子站数据或旧本地 HTML。远端同时有人工更新则停止，不强推、不覆盖他人提交；该次留到下一交易日重新处理。
4. `deploy` 通过官方 Pages Actions 发布，并同时核对线上 `deployment-version.txt` 和根 HTML 与本次提交完全一致。用 `GITHUB_TOKEN` 提交不会触发另一轮 push 工作流，因此同一次运行明确串联部署，避免“仓库更新了、网页没更新”。人工推送主页面或行业子站时也会部署已有版本，但不额外取数。
5. 取数、校验、构建或推送失败时不执行部署，保留已发布版本；部署或上线核对失败会显示失败，可从 Actions 查看具体阶段。已有低频持仓仍需按原流程补齐新的适用报告期，不能承诺自动解析所有未来报告。

## 每次看什么

- [逐项日期与核验清单](outputs/refresh-latest.md)：每个指标的实际观测日期、来源核验日期、缺失和阻断原因。
- `outputs/cloud-refresh-latest.md` / `.json`：首次交易日云端执行后生成并提交，记录本次目标日、构建验收和日／周频项目的当日日期覆盖率；这不是月报季报完整率、股票覆盖率或接口成功率，不作为自动调整执行时间的依据。
- Actions 每次运行的 **Summary**、`refresh`／`deploy` 状态和30天报告附件：包括失败、休市跳过。提交内的验收清单生成在部署前，实际发布是否成功以 `deploy` 最后线上核对为准。

没有配置额外提醒渠道。失败先看 Actions 红色记录；可在 GitHub 的通知设置中开启 Actions 失败通知。公开仓库60天没有活动时，GitHub 可能自动停用定时工作流，届时从 Actions 页面重新启用。

仓库：https://github.com/leejiazhi88-gif/1-BigA-total

线上：https://leejiazhi88-gif.github.io/1-BigA-total/
