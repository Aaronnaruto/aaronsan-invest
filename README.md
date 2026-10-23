# Aaron桑的投资平台

个人投资看板：大盘指数、持仓热图、个股资讯与事件日历，以及马股股息台（`dividend.html`）。纯静态网站，由 GitHub Pages 发布。

- `index.html` / `app.js`：主页；`dividend.html` / `dividend.js`：股息台；`style.css` / `common.js`：两页共用的明亮木系样式、配色切换和备份
- `data.json`：收盘价、资讯、要点、日历（每个交易日由 Claude 自动更新，规则见 `UPDATE.md`）
- `tickers.json`：要追踪的代码（只有代码，没有数量和成本）
- `dividends.json`：马股价格与股息，由 GitHub Actions 每个交易日自动更新（`scripts/update_dividends.py`）；追踪名单在 `dividend-tickers.json`，手动修正在 `dividend-overrides.json`

美股持仓数量和成本**不在这个仓库里**；股息台的预设持股放在 `portfolio.json`（公开，任何人打开网站都看得到），自己在浏览器里存过记录的设备以本机记录为准。其余记录，只保存在你自己浏览器的本地存储中；换设备时用网站里的「网站设置 → 全站备份」导出 / 导入。
实时价格可在「网站设置」里填入自己的 Finnhub API key（同样只存在浏览器里）。

本网站不连接任何券商账户。资讯仅供参考，不构成投资建议。
