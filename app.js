(() => {
  "use strict";
  const KINDS = {earnings:"财报", guidance:"指引", analyst:"评级", business:"业务订单", project:"项目进度", capital:"融资股本", market:"股价异动", industry:"行业", risk:"风险"};
  const LS = {h:"aaronsan.holdings", k:"aaronsan.finnhubKey", conv:"aaronsan.conv"};
  const POLL_MS = 15000;
  const S = {quotes:{}, holdings:[], news:[], meta:null, live:{}, liveErr:null, liveAt:null, loaded:false, loadErr:null,
             heat:"d1", fT:"all", fK:"all", key:false, view:"group", editId:null, delArm:null, timer:null};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const f = (n,d=2) => n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
  const usd = n => n == null || !isFinite(n) ? "—" : (n < 0 ? "−$" : "$") + f(Math.abs(n));
  const sUsd = n => n == null || !isFinite(n) ? "—" : (n > 0 ? "+$" : n < 0 ? "−$" : "$") + f(Math.abs(n));
  const pct = (n,d=2) => n == null || !isFinite(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n*100),d) + "%";
  const c = n => n == null || !isFinite(n) ? "z" : n > 0 ? "g" : n < 0 ? "l" : "z";
  const ymd = (d, tz) => new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  const today = () => ymd(new Date(), "Asia/Kuala_Lumpur");
  const dayDiff = d => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 864e5);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch(e){ return d; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch(e){ return false; } };

  /* ---------- up/down colour convention ---------- */
  function applyConv(v){
    document.documentElement.setAttribute("data-conv", v);
    $("conv").innerHTML = v === "red" ? "<b>红涨</b><i>绿跌</i>" : "<b>绿涨</b><i>红跌</i>";
  }
  let conv = lsGet(LS.conv, "green"); applyConv(conv);
  $("conv").addEventListener("click", () => { conv = conv === "red" ? "green" : "red"; applyConv(conv); lsSet(LS.conv, conv); });

  /* ---------- market clock ---------- */
  function mkt(){
    const p = new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
    const g = t => (p.find(x => x.type === t) || {}).value;
    const wd = g("weekday"), m = (+g("hour") % 24) * 60 + (+g("minute"));
    if (wd === "Sat" || wd === "Sun") return {open:false, t:"美股休市"};
    if (m >= 570 && m < 960) return {open:true, t:"美股交易中"};
    if (m >= 240 && m < 570) return {open:false, t:"美股盘前"};
    if (m >= 960 && m < 1200) return {open:false, t:"美股盘后"};
    return {open:false, t:"美股已收盘"};
  }

  /* ---------- quote math (historical closes + optional live quote) ---------- */
  function stats(sym){
    const q = S.quotes[sym], L = S.live[sym];
    let cl = q && Array.isArray(q.closes) ? [...q.closes].sort((a,b) => String(a[0]).localeCompare(String(b[0]))) : [];
    if (L && L.c > 0) {
      const ld = ymd(new Date(L.t * 1000), "America/New_York");
      cl = cl.filter(x => x[0] < ld).concat([[ld, L.c]]);
    }
    if (!cl.length) return null;
    const n = cl.length, last = +cl[n-1][1];
    const back = k => n > k ? +cl[n-1-k][1] : +cl[0][1];
    const prev = L && L.pc > 0 ? L.pc : (n > 1 ? +cl[n-2][1] : null);
    return {q: q || {sym, kind:"stock"}, cl, last, prev, live: !!(L && L.c > 0),
            d1: prev ? last/prev - 1 : null, w1: last/back(5) - 1, m1: last/back(21) - 1, date: cl[n-1][0]};
  }
  function spark(cl, up){
    if (!cl || cl.length < 2) return "";
    const v = cl.map(x => +x[1]), lo = Math.min(...v), hi = Math.max(...v), W = 200, H = 36, p = 3;
    const x = i => p + i * (W - 2*p) / (v.length - 1), y = t => hi === lo ? H/2 : p + (hi - t) * (H - 2*p) / (hi - lo);
    const pts = v.map((t,i) => x(i).toFixed(1) + "," + y(t).toFixed(1)).join(" ");
    const col = up ? "var(--gain)" : "var(--loss)";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${x(0).toFixed(1)},${H} ${pts} ${x(v.length-1).toFixed(1)},${H}" fill="${col}" fill-opacity=".12"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(v.length-1).toFixed(1)}" cy="${y(v[v.length-1]).toFixed(1)}" r="2.4" fill="${col}"/></svg>`;
  }

  /* ---------- holdings (stored only in this browser) ---------- */
  function loadHoldings(){
    try { const a = JSON.parse(lsGet(LS.h, "[]")); return Array.isArray(a) ? a.filter(h => h && h.sym) : []; } catch(e){ return []; }
  }
  function saveHoldings(){ return lsSet(LS.h, JSON.stringify(S.holdings)); }
  function rows(){
    return S.holdings.map(h => {
      const st = stats(h.sym);
      if (h.kind === "OPT") {
        const cost = h.qty * h.avg * 100;
        const mv = h.mark != null && h.mark !== "" && isFinite(h.mark) ? h.qty * h.mark * 100 : null;
        const days = h.expiry ? dayDiff(h.expiry) : null;
        const und = st ? st.last : null;
        const otm = und == null || !h.strike ? null : h.right === "CALL" ? (h.strike - und) / und : (und - h.strike) / und;
        return {...h, st, cost, mv, unr: mv == null ? null : mv - cost, day: null, days, und, otm};
      }
      const cost = h.qty * h.avg;
      if (!st) return {...h, st, cost, mv:null, unr:null, day:null};
      const mv = h.qty * st.last;
      return {...h, st, cost, mv, unr: mv - cost, day: st.prev != null ? h.qty * (st.last - st.prev) : null};
    }).sort((a,b) => (b.mv ?? -1) - (a.mv ?? -1));
  }

  /* ---------- top bar + observe ---------- */
  function renderStatus(){
    const m = mkt(), key = lsGet(LS.k, "");
    const el = $("live");
    if (key && S.liveErr) { el.className = "badge bad"; el.textContent = "实时行情出错 · " + S.liveErr; }
    else if (key && S.liveAt) { el.className = "badge on"; el.textContent = `${m.t} · 实时 ${new Date(S.liveAt).toLocaleTimeString("zh-CN",{hour12:false})}`; }
    else if (key) { el.className = "badge"; el.textContent = "实时行情连接中…"; }
    else { el.className = "badge"; el.textContent = `${m.t} · 收盘价 ${S.meta && S.meta.priceAsOf ? S.meta.priceAsOf : ""}`; }
    $("ob-meta").textContent = key && S.liveAt ? "指数以 ETF 代表 · Finnhub 实时报价，每 15 秒刷新" : "指数以 ETF 代表 · 收盘价";
  }
  function renderTiles(){
    const idx = Object.values(S.quotes).filter(q => q.kind === "index").sort((a,b) => (a.order||0) - (b.order||0));
    if (!idx.length) { $("tiles").innerHTML = `<div class="panel empty" style="grid-column:1/-1">${S.loadErr ? esc(S.loadErr) : S.loaded ? "还没有指数数据。" : "市场数据加载中…"}</div>`; return; }
    $("tiles").innerHTML = idx.map(q => {
      const s = stats(q.sym); if (!s) return "";
      return `<div class="panel tile"><div class="r1"><span class="sym">${esc(q.sym)}</span><span class="nm">${esc(q.label)}${s.live ? ' <span class="dotlive" title="实时"></span>' : ""}</span></div>
        <span class="px num">${f(s.last)}</span>
        <span class="chg num ${c(s.d1)}">${s.prev != null ? (s.last - s.prev >= 0 ? "+" : "−") + f(Math.abs(s.last - s.prev)) : "—"} (${pct(s.d1)})</span>
        ${spark(s.cl.slice(-22), s.m1 >= 0)}
        <div class="perf"><span>一周<b class="num ${c(s.w1)}">${pct(s.w1,1)}</b></span><span>一月<b class="num ${c(s.m1)}">${pct(s.m1,1)}</b></span></div></div>`;
    }).join("");
  }
  function squarify(items, x, y, w, h, out){
    if (!items.length) return;
    if (items.length === 1) { out.push({...items[0], x, y, w, h}); return; }
    const total = items.reduce((s,i) => s + i.v, 0);
    let acc = 0, k = 0;
    while (k < items.length - 1 && (acc + items[k].v) / total <= 0.5) { acc += items[k].v; k++; }
    if (k === 0) { acc = items[0].v; k = 1; }
    const a = items.slice(0,k), b = items.slice(k), r = acc / total;
    if (w >= h) { squarify(a, x, y, w*r, h, out); squarify(b, x + w*r, y, w*(1-r), h, out); }
    else { squarify(a, x, y, w, h*r, out); squarify(b, x, y + h*r, w, h*(1-r), out); }
  }
  function renderHeat(){
    const span = {d1:.03, w1:.08, m1:.15}[S.heat];
    $("lg-lo").textContent = "−" + span*100 + "%"; $("lg-hi").textContent = "+" + span*100 + "%";
    const R = rows().filter(r => r.kind !== "OPT" && r.mv > 0 && r.st);
    if (!R.length) { $("tm").innerHTML = `<div class="empty">添加股票持仓后，这里会按市值画出热图。</div>`; return; }
    const out = []; squarify(R.map(r => ({r, v:r.mv})), 0, 0, 100, 100, out);
    const tot = R.reduce((s,r) => s + r.mv, 0);
    $("tm").innerHTML = out.map(o => {
      const ch = o.r.st[S.heat], t = Math.max(-1, Math.min(1, (ch||0) / span));
      const mix = Math.round(Math.abs(t) * 85 + 10);
      const bg = `color-mix(in srgb, ${t >= 0 ? "var(--gain)" : "var(--loss)"} ${mix}%, var(--panel2))`;
      return `<div class="cell" style="left:${o.x}%;top:${o.y}%;width:${o.w}%;height:${o.h}%;background:${bg}" title="${esc(o.r.sym)} ${pct(ch)}">
        <b>${esc(o.r.sym)}</b><div><div class="cp">${pct(ch)}</div><small>${usd(o.r.mv)} · ${f(o.r.mv/tot*100,1)}%</small></div></div>`;
    }).join("");
  }
  $("heatP").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    S.heat = b.dataset.p; [...$("heatP").children].forEach(x => x.setAttribute("aria-pressed", x === b)); renderHeat();
  });
  function renderBrief(){
    const m = S.meta;
    $("note").textContent = m && m.marketNote ? m.marketNote : (S.loaded ? "还没有本周要点。" : "加载中…");
    $("note").className = m && m.marketNote ? "" : "z";
    $("hl").innerHTML = (m && Array.isArray(m.highlights) ? m.highlights : []).map(h => `<li><span class="t">${esc(h.sym)}</span><span>${esc(h.text)}</span></li>`).join("");
  }

  /* ---------- holdings ---------- */
  function renderHoldings(){
    const R = rows();
    const stk = R.filter(r => r.kind !== "OPT");
    const mv = stk.reduce((s,r) => s + (r.mv||0), 0);
    const day = stk.reduce((s,r) => s + (r.day||0), 0);
    const known = R.filter(r => r.unr != null);
    const unr = known.reduce((s,r) => s + r.unr, 0), kcost = known.reduce((s,r) => s + r.cost, 0);
    const cost = R.reduce((s,r) => s + r.cost, 0);
    const optNoMark = R.filter(r => r.kind === "OPT" && r.mv == null);
    $("s-mv").textContent = R.length ? usd(mv) : "—";
    $("s-mv2").textContent = R.length ? `${stk.length} 只股票${R.length > stk.length ? ` · ${R.length - stk.length} 个期权另计` : ""}` : "还没有持仓";
    const d = $("s-d"); d.textContent = R.length ? sUsd(day) : "—"; d.className = "v num " + c(day);
    $("s-d2").textContent = mv - day > 0 ? "较前收 " + pct(day/(mv-day)) : "";
    const u = $("s-u"); u.textContent = known.length ? sUsd(unr) : "—"; u.className = "v num " + c(unr);
    $("s-u2").textContent = kcost > 0 ? "回报 " + pct(unr/kcost,1) + (optNoMark.length ? " · 不含未估值期权" : "") : "";
    $("s-c").textContent = R.length ? usd(cost) : "—";
    $("s-c2").textContent = optNoMark.length ? `含期权成本 ${usd(optNoMark.reduce((s,r)=>s+r.cost,0))}` : "";
    $("ho-meta").textContent = "按市值排序 · 持仓只保存在这台设备的浏览器里";

    if (!R.length) { $("cards").innerHTML = `<div class="panel empty" style="grid-column:1/-1">这台设备还没有持仓。展开下方“管理持仓”逐笔添加，或在“网站设置”里一次导入。</div>`; return; }
    $("cards").innerHTML = R.map(r => {
      if (r.kind === "OPT") {
        const soon = r.days != null && r.days <= 14;
        return `<article class="panel qc optcard"><div class="r1">
            <div class="tk"><b>${esc(r.sym)} ${f(r.strike, r.strike % 1 ? 2 : 0)} ${r.right === "CALL" ? "看涨" : "看跌"}<span class="chipk">期权</span></b><span>${esc(r.expiry || "")} 到期 · ${f(r.qty,0)} 张</span></div>
            <div class="px"><b>${r.days == null ? "—" : Math.max(r.days,0)}</b><span class="${soon ? "warn" : "z"}">天后到期</span></div></div>
          <div class="kv"><div><span class="lbl">正股</span><span class="num">${r.und == null ? "—" : f(r.und)}</span></div>
            <div><span class="lbl">${r.otm != null && r.otm > 0 ? "价外" : "价内"}</span><span class="num ${r.otm != null && r.otm > 0 ? "warn" : ""}">${r.otm == null ? "—" : f(Math.abs(r.otm*100),1) + "%"}</span></div>
            <div><span class="lbl">成本</span><span class="num">${usd(r.cost)}</span></div></div>
          <div class="row2"><span>${r.mv == null ? "未填期权现价，不计入市值" : "现值 " + usd(r.mv) + ` · <span class="${c(r.unr)}">${sUsd(r.unr)}</span>`}</span><span>成本价 ${f(r.avg,3)}</span></div>
        </article>`;
      }
      if (!r.st) return `<article class="panel qc"><div class="r1"><div class="tk"><b>${esc(r.sym)}</b><span>${f(r.qty, r.qty % 1 ? 2 : 0)} 股 · 成本 ${f(r.avg)}</span></div><div class="px"><b>—</b><span class="z">等待价格</span></div></div>
        <div class="row2"><span>${lsGet(LS.k, "") ? "实时行情拉取中，或代码不在美股。" : "在“网站设置”里填 Finnhub key 即可显示实时价格。"}</span></div></article>`;
      const s = r.st, q = s.q, rangePos = q.lo52 && q.hi52 ? Math.max(0, Math.min(100, (s.last - q.lo52) / (q.hi52 - q.lo52) * 100)) : null;
      const tgt = q.target ? q.target / s.last - 1 : null;
      return `<article class="panel qc"><div class="r1">
          <div class="tk"><b>${esc(r.sym)}${s.live ? ' <span class="dotlive" title="实时"></span>' : ""}</b><span>${esc(q.label || "")}${q.label ? " · " : ""}${f(r.qty, r.qty % 1 ? 2 : 0)} 股</span></div>
          <div class="px"><b>${f(s.last)}</b><span class="num ${c(s.d1)}">${pct(s.d1)}</span></div></div>
        ${spark(s.cl.slice(-22), s.m1 >= 0)}
        <div class="kv"><div><span class="lbl">市值</span><span class="num">${usd(r.mv)}</span></div>
          <div><span class="lbl">一周</span><span class="num ${c(s.w1)}">${s.cl.length > 5 ? pct(s.w1,1) : "—"}</span></div>
          <div><span class="lbl">一月</span><span class="num ${c(s.m1)}">${s.cl.length > 21 ? pct(s.m1,1) : "—"}</span></div></div>
        <div class="row2"><span>未实现 <span class="num ${c(r.unr)}">${sUsd(r.unr)} (${pct(r.unr/r.cost,1)})</span></span><span>成本 ${f(r.avg)}</span></div>
        ${rangePos != null ? `<div class="range"><span>52 周区间</span><div class="bar"><i style="left:calc(${rangePos.toFixed(1)}% - 1px)"></i></div><div class="ends num"><span>${f(q.lo52)}</span><span>${f(q.hi52)}</span></div></div>` : ""}
        <div class="row2">${tgt != null ? `<span>分析师目标 ${f(q.target)} <span class="${c(tgt)}">(${pct(tgt,0)})</span></span>` : "<span></span>"}${q.nextEarnings ? `<span>财报 ${esc(q.nextEarnings)}</span>` : ""}</div>
      </article>`;
    }).join("");
  }

  /* ---------- holdings manager ---------- */
  function renderMgr(){
    const H = [...S.holdings].sort((a,b) => a.sym.localeCompare(b.sym));
    $("hlist").innerHTML = H.length ? H.map(h => `<div class="hrow"><span class="grow"><b class="num">${esc(h.sym)}</b> ${h.kind === "OPT" ? `${f(h.strike,0)} ${h.right === "CALL" ? "看涨" : "看跌"} · ${esc(h.expiry)} · ${f(h.qty,0)} 张 @ ${f(h.avg,3)}` : `${f(h.qty, h.qty % 1 ? 2 : 0)} 股 @ ${f(h.avg)}`}</span>
      <button class="btn" type="button" data-edit="${esc(h.id)}">修改</button>
      <button class="btn danger" type="button" data-del="${esc(h.id)}">${S.delArm === h.id ? "确认删除" : "删除"}</button></div>`).join("") : `<div class="z" style="font-size:.84rem">还没有持仓。</div>`;
  }
  function toggleOpt(){ const o = $("f-kind").value === "OPT"; document.querySelectorAll("form.hf .opt").forEach(el => el.hidden = !o); }
  $("f-kind").addEventListener("change", toggleOpt);
  $("hlist").addEventListener("click", e => {
    const ed = e.target.closest("[data-edit]"), dl = e.target.closest("[data-del]");
    if (ed) {
      const h = S.holdings.find(x => x.id === ed.dataset.edit); if (!h) return;
      S.editId = h.id; $("f-sym").value = h.sym; $("f-kind").value = h.kind; $("f-qty").value = h.qty; $("f-avg").value = h.avg;
      $("f-strike").value = h.strike ?? ""; $("f-right").value = h.right || "PUT"; $("f-exp").value = h.expiry || ""; $("f-mark").value = h.mark ?? "";
      toggleOpt(); $("f-save").textContent = "保存修改"; $("f-msg").textContent = "正在修改 " + h.sym; $("f-sym").focus();
    }
    if (dl) {
      const id = dl.dataset.del;
      if (S.delArm !== id) { S.delArm = id; renderMgr(); return; }
      S.delArm = null; S.holdings = S.holdings.filter(h => h.id !== id); saveHoldings();
      $("f-msg").textContent = "已删除"; afterHoldingsChange();
    }
  });
  $("hf").addEventListener("submit", e => {
    e.preventDefault();
    const sym = $("f-sym").value.trim().toUpperCase(), kind = $("f-kind").value;
    const qty = parseFloat($("f-qty").value), avg = parseFloat($("f-avg").value);
    if (!/^[A-Z0-9.\-]{1,12}$/.test(sym) || !(qty > 0) || !(avg >= 0)) { $("f-msg").textContent = "请填写有效的代码、数量和成本价。"; return; }
    const doc = {sym, kind, qty, avg, updatedAt: today()};
    if (kind === "OPT") {
      const strike = parseFloat($("f-strike").value), exp = $("f-exp").value;
      if (!(strike > 0) || !exp) { $("f-msg").textContent = "期权需要填写行权价和到期日。"; return; }
      doc.strike = strike; doc.right = $("f-right").value; doc.expiry = exp;
      const mk = parseFloat($("f-mark").value); doc.mark = isFinite(mk) ? mk : null;
    }
    const id = S.editId || (kind === "OPT" ? `${sym}-${doc.strike}${doc.right[0]}-${doc.expiry}` : sym);
    doc.id = id;
    S.holdings = S.holdings.filter(h => h.id !== id).concat([doc]);
    const ok = saveHoldings();
    $("f-msg").textContent = ok ? "已保存 " + sym : "已更新页面，但浏览器不允许保存（可能是无痕模式），刷新后会丢失。";
    $("hf").reset(); S.editId = null; $("f-save").textContent = "保存持仓"; toggleOpt();
    afterHoldingsChange();
  });
  function afterHoldingsChange(){ renderAll(); if (lsGet(LS.k, "")) pollLive(); }

  /* ---------- settings: Finnhub key + import/export ---------- */
  function renderSettings(){
    const k = lsGet(LS.k, "");
    $("k-state").textContent = k ? `已保存 key（尾号 ${k.slice(-4)}），只存在这台设备的浏览器里。` : "未设置：网站显示 data.json 里的收盘价。";
  }
  $("k-form").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("k-in").value.trim();
    if (!/^[A-Za-z0-9]{10,64}$/.test(v)) { $("k-state").textContent = "这看起来不像 Finnhub 的 API key，请从 finnhub.io 的 Dashboard 复制。"; return; }
    lsSet(LS.k, v); $("k-in").value = ""; S.liveErr = null; renderSettings(); startLive();
  });
  $("k-clear").addEventListener("click", () => { lsSet(LS.k, null); stopLive(); S.live = {}; S.liveAt = null; S.liveErr = null; renderSettings(); renderAll(); });
  $("io-export").addEventListener("click", async () => {
    const txt = JSON.stringify(S.holdings.map(({id, ...h}) => h), null, 1);
    $("io-text").value = txt;
    try { await navigator.clipboard.writeText(txt); $("io-msg").textContent = "已复制到剪贴板，也显示在上面的输入框里。"; }
    catch(e){ $("io-text").select(); $("io-msg").textContent = "已显示在输入框里，请手动复制。"; }
  });
  $("io-import").addEventListener("click", () => {
    let arr; try { arr = JSON.parse($("io-text").value); } catch(e){ $("io-msg").textContent = "格式不对：请粘贴完整的 JSON（以 [ 开头，以 ] 结尾）。"; return; }
    if (!Array.isArray(arr)) { $("io-msg").textContent = "格式不对：需要一个持仓列表。"; return; }
    const clean = arr.filter(h => h && typeof h.sym === "string" && isFinite(h.qty) && isFinite(h.avg)).map(h => {
      const sym = h.sym.toUpperCase(), kind = h.kind === "OPT" ? "OPT" : "STK";
      const o = {sym, kind, qty:+h.qty, avg:+h.avg, updatedAt: today()};
      if (kind === "OPT") { o.strike = +h.strike; o.right = h.right === "CALL" ? "CALL" : "PUT"; o.expiry = String(h.expiry || ""); o.mark = isFinite(h.mark) && h.mark !== null ? +h.mark : null; }
      o.id = kind === "OPT" ? `${sym}-${o.strike}${o.right[0]}-${o.expiry}` : sym;
      return o;
    });
    if (!clean.length) { $("io-msg").textContent = "没有找到有效的持仓。"; return; }
    S.holdings = clean; saveHoldings(); $("io-msg").textContent = `已导入 ${clean.length} 笔持仓。`; afterHoldingsChange();
  });

  /* ---------- live quotes (Finnhub, optional) ---------- */
  function liveSyms(){ return [...new Set([...Object.values(S.quotes).map(q => q.sym), ...S.holdings.map(h => h.sym)])]; }
  async function pollLive(){
    const key = lsGet(LS.k, ""); if (!key) return;
    const syms = liveSyms(); let ok = 0, err = null;
    await Promise.all(syms.map(async sym => {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`, {cache:"no-store"});
        if (r.status === 401 || r.status === 403) { err = "key 无效或没有权限"; return; }
        if (r.status === 429) { err = "请求太频繁，稍后自动恢复"; return; }
        if (!r.ok) { err = "Finnhub 返回 " + r.status; return; }
        const j = await r.json();
        if (j && j.c > 0) { S.live[sym] = j; ok++; }
      } catch(e){ err = err || "网络连接失败"; }
    }));
    if (ok) { S.liveAt = Date.now(); S.liveErr = null; } else { S.liveErr = err || "没有拿到报价"; }
    renderAll();
  }
  function startLive(){ stopLive(); pollLive(); S.timer = setInterval(() => { if (!document.hidden) pollLive(); }, POLL_MS); }
  function stopLive(){ if (S.timer) clearInterval(S.timer); S.timer = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.timer) pollLive(); });

  /* ---------- news ---------- */
  function heldSyms(){ return [...new Set(rows().map(r => r.sym))]; }
  function allItems(){ const out = []; S.news.forEach(n => (Array.isArray(n.items) ? n.items : []).forEach(i => out.push({...i, sym:n.ticker}))); return out; }
  function pass(i){ return (S.fT === "all" || i.sym === S.fT) && (S.fK === "all" || i.kind === S.fK) && (!S.key || i.key); }
  function itemHtml(i, showSym){
    return `<li class="s-${esc(i.sentiment || "neutral")}${i.key ? " key" : ""}">
      <div class="ir">${i.key ? `<span class="star">重点</span>` : ""}${showSym ? `<span class="symt">${esc(i.sym)}</span>` : ""}<span class="num">${esc(i.date || "近期")}</span><span class="kt">${esc(KINDS[i.kind] || "资讯")}</span>${i.source ? `<span>${esc(i.source)}</span>` : ""}</div>
      <h4>${esc(i.headline)}</h4>${i.summary ? `<p>${esc(i.summary)}</p>` : ""}
      ${/^https:\/\//.test(i.url || "") ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">阅读原文 ↗</a>` : ""}</li>`;
  }
  function renderNews(){
    const syms = [...new Set([...heldSyms(), ...S.news.map(n => n.ticker)])];
    const cnt = k => allItems().filter(i => (S.fT === "all" || i.sym === S.fT) && i.kind === k).length;
    $("fT").innerHTML = [["all","全部"], ...syms.map(s => [s,s])].map(([v,l]) => `<button type="button" class="chip" data-ft="${esc(v)}" aria-pressed="${S.fT === v}">${esc(l)}</button>`).join("");
    $("fK").innerHTML = `<button type="button" class="chip key" data-key="1" aria-pressed="${S.key}">只看重点</button>` +
      [["all","全部类型"], ...Object.entries(KINDS).filter(([k]) => cnt(k) > 0)].map(([v,l]) => `<button type="button" class="chip" data-fk="${esc(v)}" aria-pressed="${S.fK === v}">${esc(l)}</button>`).join("");
    const box = $("feed");
    if (!S.loaded) { box.innerHTML = `<div class="panel empty">${S.loadErr ? esc(S.loadErr) : "资讯加载中…"}</div>`; return; }
    if (!S.news.length) { box.innerHTML = `<div class="panel empty">还没有资讯。</div>`; return; }
    if (S.view === "time") {
      const it = allItems().filter(pass).sort((a,b) => String(b.date||"").localeCompare(String(a.date||"")));
      box.innerHTML = it.length ? `<div class="panel tl"><ul class="items">${it.map(i => itemHtml(i, true)).join("")}</ul></div>` : `<div class="panel empty">这个筛选条件下没有资讯。</div>`;
      return;
    }
    const order = heldSyms();
    const docs = [...S.news].sort((a,b) => { const x = order.indexOf(a.ticker), y = order.indexOf(b.ticker); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
    const html = docs.map(n => {
      const it = (Array.isArray(n.items) ? n.items : []).map(i => ({...i, sym:n.ticker})).filter(pass).sort((a,b) => String(b.date||"").localeCompare(String(a.date||"")));
      if (!it.length) return "";
      return `<article class="panel nc"><div class="nh"><div class="r"><h3>${esc(n.ticker)}<span>${esc(n.company)}</span></h3><span class="z" style="font-size:.74rem">${it.length} 条</span></div>
        ${n.watch ? `<div class="watch"><b>关注</b>${esc(n.watch)}</div>` : ""}</div>
        <ul class="items">${it.map(i => itemHtml(i, false)).join("")}</ul>
        ${n.updatedAt ? `<div class="nf">整理于 ${esc(n.updatedAt)}</div>` : ""}</article>`;
    }).join("");
    box.innerHTML = html ? `<div class="ngrid">${html}</div>` : `<div class="panel empty">这个筛选条件下没有资讯。</div>`;
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-ft]"), k = e.target.closest("[data-fk]"), ky = e.target.closest("[data-key]"), v = e.target.closest("#view button[data-v]");
    if (t) { S.fT = t.dataset.ft; renderNews(); }
    if (k) { S.fK = k.dataset.fk; renderNews(); }
    if (ky) { S.key = !S.key; renderNews(); }
    if (v) { S.view = v.dataset.v; [...$("view").children].forEach(x => x.setAttribute("aria-pressed", x === v)); renderNews(); }
  });

  /* ---------- calendar ---------- */
  function renderCal(){
    const ev = [];
    ((S.meta && S.meta.events) || []).forEach(e => ev.push(e));
    Object.values(S.quotes).forEach(q => { if (q.nextEarnings && q.kind !== "index") ev.push({date:q.nextEarnings, sym:q.sym, label:"公布财报" + (q.earningsNote ? "（" + q.earningsNote + "）" : "")}); });
    S.holdings.filter(h => h.kind === "OPT" && h.expiry).forEach(h => ev.push({date:h.expiry, sym:h.sym, label:`你的 $${h.strike} ${h.right === "CALL" ? "看涨" : "看跌"}期权到期`}));
    const seen = new Set();
    const list = ev.filter(e => { const k = e.date + e.sym + e.label; if (seen.has(k)) return false; seen.add(k); return true; })
      .filter(e => /^\d{4}-\d{2}/.test(e.date || "") && (e.date.length < 10 || dayDiff(e.date) >= -10))
      .sort((a,b) => a.date.localeCompare(b.date));
    $("cal").innerHTML = list.length ? list.map(e => {
      const full = e.date.length >= 10, dd = full ? dayDiff(e.date) : null;
      const tag = dd == null ? `<span class="pill">待定</span>` : dd < 0 ? `<span class="pill">${-dd} 天前</span>` : dd === 0 ? `<span class="pill soon">今天</span>` : `<span class="pill ${dd <= 14 ? "soon" : ""}">${dd} 天后</span>`;
      return `<tr class="${dd != null && dd < 0 ? "past" : ""}"><td class="dd">${esc(e.date)}</td><td class="num">${esc(e.sym)}</td><td>${esc(e.label)}</td><td>${tag}</td></tr>`;
    }).join("") : `<tr><td colspan="4" class="empty">暂无事件。</td></tr>`;
  }

  function renderAll(){ renderStatus(); renderTiles(); renderBrief(); renderHeat(); renderHoldings(); renderMgr(); renderNews(); renderCal(); }

  /* ---------- boot ---------- */
  S.holdings = loadHoldings();
  renderSettings(); renderAll();
  setInterval(renderStatus, 30000);
  fetch("data.json", {cache:"no-store"}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
    S.quotes = {}; (d.quotes || []).forEach(q => { if (q && q.sym) S.quotes[q.sym] = q; });
    S.news = Array.isArray(d.news) ? d.news : []; S.meta = d.meta || null; S.loaded = true;
    renderAll(); if (lsGet(LS.k, "")) startLive();
  }).catch(() => {
    S.loaded = true; S.loadErr = "读不到 data.json。请确认它和 index.html 放在同一个文件夹，并通过网址打开（不是直接双击文件）。";
    renderAll(); if (lsGet(LS.k, "")) startLive();
  });
})();
