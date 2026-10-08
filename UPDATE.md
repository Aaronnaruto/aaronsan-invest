# 每日更新规则（给自动更新的 Claude 看）

本仓库是「Aaron桑的投资平台」的静态网站，由 GitHub Pages 发布。网站只读 `data.json`。
每次更新只改 `data.json`，不改 `index.html` / `app.js`，不提交任何持仓数量、成本或个人资料。

## 步骤
1. 读 `tickers.json`，得到要追踪的指数和个股。
2. **价格**：用 WebFetch 读 `https://stockanalysis.com/stocks/<sym小写>/history/`（ETF 用 `/etf/<sym>/history/`），
   取最近的每日收盘价，合并进 `data.json` 里对应 `quotes[].closes`（`[日期, 收盘]`，按日期升序，只保留最近 40 个交易日）。
   同时更新个股的 `lo52`、`hi52`、`target`（分析师平均目标价）、`nextEarnings`（有公布才填）。
   新加入 `tickers.json` 的代码要新建 quote（`kind` 为 `index` 或 `stock`，带 `label`）。
3. **资讯**：对每只个股搜索最近 3 天的新闻，**不只是业绩**，要覆盖：
   项目进度、订单合同、融资与股本变动、内部人交易、评级变动、行业事件、监管与诉讼、单日大涨大跌的原因。
   每条写进 `news[].items` 最前面：
   `{date, kind, sentiment, key?, source, url, headline, summary}`
   - `kind`：earnings / guidance / analyst / business / project / capital / market / industry / risk
   - `sentiment`：pos / neg / watch
   - 对股价影响大的标 `"key": true`
   - `headline` 一句话说清事件和数字；`summary` 2–3 句讲原因、规模、影响，全部用简体中文
   - 只收有原文链接、能核实的内容；同一事件不要重复收
   - 每只股票最多保留最近 15 条
   同时更新该股的 `watch`（接下来要关注什么）和 `updatedAt`。
4. **观察区**：更新 `meta.priceAsOf`（例如 `2026-10-07 美股收盘`）、`meta.marketNote`（3–4 句当周市场概况，涨跌幅用 `data.json` 里的价格算，不要估）、
   `meta.highlights`（每只个股一条最重要的事）、`meta.events`（财报日、项目节点、除息日等，删掉已过去超过 10 天的）。
5. 检查 `data.json` 是合法 JSON，`updatedAt` 改成今天（吉隆坡时间）。
6. 提交信息：`data: 更新至 <最新收盘日>`，推送到 `main`。

## 不要做的事
- 不要连接或调用任何券商（IBKR 等）。
- 不要把持仓数量、成本、账户信息写进仓库。
- 美股休市日（周末、美国假日）如果没有新收盘价，只更新资讯，不要编造价格。
