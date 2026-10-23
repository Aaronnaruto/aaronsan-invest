# 每日更新规则（给自动更新的 Claude 看）

本仓库是「Aaron桑的投资平台」的静态网站，由 GitHub Pages 发布。主页读 `data.json`，股息页（`dividend.html`）读 `dividends.json`。
每次更新只改 `data.json`，不改页面文件（`index.html` / `dividend.html` / `*.js` / `style.css`），不提交任何持仓数量、成本或个人资料。

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

## 股息台（dividends.json）—— 由 GitHub Actions 自动更新，Claude 不用改
- `.github/workflows/dividends.yml` 每个交易日 MYT 18:37 运行 `scripts/update_dividends.py`，自动写 `dividends.json` 并推送。
  也会在改动 `dividend-tickers.json` / `dividend-overrides.json` 后自动运行一次。
- 价格与除息：Yahoo Finance（`<代码>.KL`）；登记日、发放日、已宣布股息：stockanalysis.com。
- `portfolio.json` 是股息台的预设持股（Aaron 要求放进网站，方便家人直接打开看）。只有 Aaron 要求时才改它，自动更新不要动。
- **不要手动编辑 `dividends.json`**，下次运行会被覆盖。
- 要新增或删除股息台追踪的股票：改 `dividend-tickers.json`（code = Bursa 代码，slug = Bursa 简称，type = stock / reit）。
- 要按 Bursa 公告修正某一笔股息（标记特别股息、写明中期/末期、补发放日或补一笔漏掉的股息）：改 `dividend-overrides.json`，格式见文件里的说明。
- 如果 Action 失败（在 GitHub 的 Actions 页面看到红色），通常是数据源暂时不可用，下一个交易日会自动重试；
  某只股票抓取失败时会沿用上一次的数据，并在该股的 `err` 字段写明原因。
