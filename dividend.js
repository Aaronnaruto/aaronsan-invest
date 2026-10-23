/* 股息台：读 dividends.json（公开数据）+ 浏览器里的买卖记录（私人数据），全部在本地计算 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ok = n => n != null && isFinite(n);
  const f = (n, d = 2) => !ok(n) ? "—" : Number(n).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
  const rm = (n, d = 2) => !ok(n) ? "—" : (n < 0 ? "−" : "") + "RM " + f(Math.abs(n), d);
  const sRm = n => !ok(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + "RM " + f(Math.abs(n));
  const pc = (n, d = 2) => !ok(n) ? "—" : f(n * 100, d) + "%";
  const cls = n => !ok(n) ? "z" : n > 0 ? "g" : n < 0 ? "l" : "z";
  const px = n => !ok(n) ? "—" : f(n, n < 1 ? 3 : 2);
  const dps = n => !ok(n) ? "—" : String(+n.toFixed(4)).replace(/^(\d+)$/, "$1.00").replace(/^(\d+\.\d)$/, "$10");
  const qty = n => f(n, 0) + " 股" + (n >= 100 && n % 100 === 0 ? ` · ${f(n / 100, 0)} lot` : "");

  const DAY = 864e5;
  const toD = s => Date.parse(s + "T00:00:00Z");
  const fromD = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => fromD(toD(s) + n * DAY);
  const TODAY = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kuala_Lumpur", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
  const CUR = TODAY.slice(0, 7);
  const addM = (k, n) => { let [y, m] = k.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return y + "-" + String(m).padStart(2, "0"); };
  const mEnd = k => { const [y, m] = k.split("-").map(Number); return fromD(Date.UTC(y, m, 0)); };
  const median = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
  const mLabel = k => +k.slice(5) + "月";
  const ST = {paid:"已到账", pend:"待发放", decl:"已宣布", proj:"预估"};

  const DEF = {target:3000, wht:10, tax:false, taxTh:100000, taxR:2};
  const S = {data:null, list:[], by:{}, err:null, st:AS.loadDiv(), rf:"all", exSp:true, sort:{k:"dy", dir:-1},
             pcv:"list", sel:null, yrs:10, more:false, editId:null, delArm:null, M:null};
  const cfg = () => ({...DEF, ...S.st.settings});
  const save = () => S.demo ? false : AS.saveDiv(S.st);

  /* ---------- 示例模式：用示例持股预览，不保存 ---------- */
  const SAMPLE = [
    {id:"x1", code:"1155", date:"2024-02-05", side:"B", px:9.70, qty:1000, fee:25},
    {id:"x2", code:"5176", date:"2024-06-10", side:"B", px:1.60, qty:5000, fee:20},
    {id:"x3", code:"6033", date:"2025-01-15", side:"B", px:18.00, qty:300, fee:20},
    {id:"x4", code:"1155", date:"2025-04-10", side:"B", px:9.50, qty:500, fee:15},
    {id:"x5", code:"6947", date:"2025-08-20", side:"B", px:2.70, qty:3000, fee:20},
    {id:"x6", code:"5176", date:"2025-11-03", side:"S", px:2.00, qty:1000, fee:10}];
  function setDemo(on){
    S.demo = on; S.st = on ? {trades: SAMPLE.map(t => ({...t, note:""})), settings: S.st.settings} : AS.loadDiv();
    $("demo-bar").hidden = !on; renderAll();
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-demo]"); if (b) setDemo(b.dataset.demo === "on"); });

  /* ---------- 涨跌颜色（和主页共用设置） ---------- */
  function applyConv(v){ document.documentElement.setAttribute("data-conv", v); $("conv").innerHTML = v === "red" ? "<b>红涨</b><i>绿跌</i>" : "<b>绿涨</b><i>红跌</i>"; }
  let conv = AS.get("aaronsan.conv", "green"); applyConv(conv);
  $("conv").addEventListener("click", () => { conv = conv === "red" ? "green" : "red"; applyConv(conv); AS.set("aaronsan.conv", conv); });

  /* ---------- 公开数据预处理 ---------- */
  function prep(s){
    s.divs = (s.divs || []).filter(d => d && d.ex && ok(d.amt)).sort((a, b) => a.ex.localeCompare(b.ex));
    const lags = s.divs.filter(d => d.pay).map(d => (toD(d.pay) - toD(d.ex)) / DAY).filter(x => x >= 0 && x < 120);
    s.lag = Math.round(median(lags) ?? 21);
    s.divs.forEach(d => {
      d.payE = d.pay || addDays(d.ex, s.lag); d.est = !d.pay;
      if (typeof d.special === "boolean") { d.sp = d.special; return; }
      // 特别股息：比前后三年中位数和「去年 / 明年同一期」都高 2.5 倍以上（避免把末期股息误判）
      const near = s.divs.filter(x => x !== d && Math.abs(toD(x.ex) - toD(d.ex)) <= 1096 * DAY).map(x => x.amt);
      const slot = s.divs.filter(x => x !== d && [365, -365].some(k => Math.abs((toD(x.ex) - toD(d.ex)) / DAY - k) <= 75)).map(x => x.amt);
      d.sp = near.length >= 3 && slot.length > 0 && d.amt >= 2.5 * median(near) && d.amt >= 2.5 * Math.max(...slot);
    });
    s.mm = {}; (s.m || []).forEach(([k, v]) => s.mm[k] = v);
    s.dd = s.d || [];
    s._ser = {};
    return s;
  }
  function priceAt(s, date){
    const d = s.dd;
    if (d.length && date >= d[0][0]) { let lo = 0, hi = d.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (d[mid][0] <= date) lo = mid; else hi = mid - 1; } return d[lo][1]; }
    let k = date.slice(0, 7);
    for (let i = 0; i < 3; i++) { if (s.mm[k] != null) return s.mm[k]; k = addM(k, -1); }
    return null;
  }
  const ttm = (s, date, exSp) => s.divs.reduce((a, d) => d.ex > addDays(date, -365) && d.ex <= date && !(exSp && d.sp) ? a + d.amt : a, 0);
  function series(s, exSp){
    const key = exSp ? 1 : 0; if (s._ser[key]) return s._ser[key];
    const m = s.m || [], out = [];
    if (m.length && s.divs.length) {
      const first = m[0][0];
      let k = toD(s.divs[0].ex) < toD(first + "-01") - 365 * DAY ? first : addM(first, 12);
      for (; k <= CUR; k = addM(k, 1)) {
        const isCur = k === CUR, date = isCur ? (s.lastDate || TODAY) : mEnd(k), p = isCur && ok(s.last) ? s.last : s.mm[k];
        if (!ok(p) || p <= 0) continue;
        out.push({k, date, px:p, dy: ttm(s, date, exSp) / p});
      }
    }
    return (s._ser[key] = out.slice(-120));
  }
  function stats(s, exSp){
    const ser = series(s, exSp), v = ser.map(p => p.dy);
    if (!v.length || !ok(s.last)) return null;
    const cur = ttm(s, TODAY, exSp) / s.last;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    const pct = v.filter(x => x <= cur + 1e-12).length / v.length;
    const v5 = v.slice(-60), m5 = v5.reduce((a, b) => a + b, 0) / v5.length;
    return {cur, mean, sd, pct, m5, years: v.length / 12, n: v.length};
  }
  function freq(s){
    // 过去 3 年的派息次数（10 天内的两笔算一次，如 REIT 连续两天除息）
    let n = 0, lastEx = null;
    s.divs.filter(d => !d.sp && d.ex > addDays(TODAY, -1095) && d.ex <= TODAY).forEach(d => { if (!lastEx || toD(d.ex) - toD(lastEx) > 10 * DAY) n++; lastEx = d.ex; });
    n /= 3;
    return n >= 3.5 ? "季度" : n >= 2.5 ? "一年三次" : n >= 1.5 ? "半年" : n >= 0.75 ? "每年" : n > 0 ? "不定期" : "—";
  }
  function nextEx(s){
    const ann = s.divs.filter(d => d.ex > TODAY)[0];
    if (ann) return {date: ann.ex, ann: true};
    const c = s.divs.filter(d => !d.sp && d.ex > addDays(TODAY, -365) && d.ex <= TODAY).map(d => addDays(d.ex, 365)).filter(x => x > TODAY).sort()[0];
    return c ? {date: c, ann: false} : null;
  }
  const nextExTxt = s => { const n = nextEx(s); return !n ? "—" : n.ann ? `${n.date.slice(5)} 已宣布` : `约 ${n.date.slice(0, 7)}`; };

  /* ---------- 私人数据：持股与股息事件 ---------- */
  const trades = () => [...S.st.trades].sort((a, b) => a.date.localeCompare(b.date) || (a.side === "S") - (b.side === "S"));
  function positions(){
    const m = {};
    for (const t of trades()) {
      const p = m[t.code] || (m[t.code] = {code:t.code, qty:0, cost:0, real:0, first:t.date});
      if (t.side === "S") { const avg = p.qty > 0 ? p.cost / p.qty : 0, q = Math.min(t.qty, p.qty); p.cost -= avg * q; p.qty -= q; p.real += t.px * q - (t.fee || 0) - avg * q; }
      else { p.qty += t.qty; p.cost += t.px * t.qty + (t.side === "B" ? (t.fee || 0) : 0); }
      if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
    }
    return m;
  }
  function events(P){
    const c = cfg(), out = [], tr = trades();
    for (const code of Object.keys(P)) {
      const s = S.by[code]; if (!s) continue;
      const ts = tr.filter(t => t.code === code);
      const before = d => ts.reduce((q, t) => t.date < d ? q + (t.side === "S" ? -t.qty : t.qty) : q, 0);
      const wht = s.type === "reit" ? c.wht / 100 : 0, reit = s.type === "reit";
      for (const d of s.divs) {
        if (d.ex <= ts[0].date) continue;
        const sh = before(d.ex); if (sh <= 0) continue;
        const gross = sh * d.amt, net = gross * (1 - wht);
        const status = d.ex > TODAY ? "decl" : d.payE <= TODAY ? "paid" : "pend";
        out.push({code, s, ex:d.ex, pay:d.payE, payEst:d.est, amt:d.amt, sh, gross, net, cash:net, drp:0, status, reit, sp:d.sp});
      }
      const cur = P[code].qty;
      if (cur > 0) {
        for (const d of s.divs.filter(d => !d.sp && d.ex > addDays(TODAY, -365) && d.ex <= TODAY)) {
          const pex = addDays(d.ex, 365);
          if (s.divs.some(x => x.ex > TODAY && Math.abs(toD(x.ex) - toD(pex)) <= 45 * DAY)) continue;
          const gross = cur * d.amt, net = gross * (1 - wht);
          out.push({code, s, ex:pex, pay:addDays(pex, Math.round((toD(d.payE) - toD(d.ex)) / DAY)), payEst:true, amt:d.amt, sh:cur, gross, net, cash:net, drp:0, status:"proj", reit, sp:false});
        }
      }
      for (const t of ts.filter(t => t.side === "DRP")) {
        const e = out.filter(e => e.code === code && e.status !== "proj" && e.pay <= addDays(t.date, 10) && e.pay >= addDays(t.date, -60)).sort((a, b) => b.pay.localeCompare(a.pay))[0];
        if (e) { const v = Math.min(e.cash, t.px * t.qty); e.drp += v; e.cash -= v; }
      }
    }
    return out.sort((a, b) => a.pay.localeCompare(b.pay) || a.code.localeCompare(b.code));
  }
  const taxOn = (list) => { const c = cfg(); if (!c.tax) return 0; const g = list.filter(e => !e.reit).reduce((a, e) => a + e.gross, 0); return Math.max(0, g - c.taxTh) * c.taxR / 100; };

  function model(){
    const P = positions(), ev = events(P), held = Object.values(P).filter(p => p.qty > 0);
    let cost = 0, mv = 0, ttmG = 0, missing = 0;
    held.forEach(p => { const s = S.by[p.code]; cost += p.cost; if (s && ok(s.last)) { mv += p.qty * s.last; ttmG += p.qty * ttm(s, TODAY, S.exSp); } else missing++; });
    const lo = addDays(TODAY, -365), hi = addDays(TODAY, 365);
    const paid = ev.filter(e => e.status === "paid");
    const ttmCash = paid.filter(e => e.pay > lo).reduce((a, e) => a + e.cash, 0);
    const fwdList = ev.filter(e => e.status !== "paid" && e.pay > TODAY && e.pay <= hi);
    const fwdTax = taxOn(fwdList);
    const fwd = fwdList.reduce((a, e) => a + e.cash, 0) - fwdTax;
    const fwdAnn = fwdList.filter(e => e.status !== "proj").reduce((a, e) => a + e.cash, 0);
    const all = paid.reduce((a, e) => a + e.cash, 0), drp = paid.reduce((a, e) => a + e.drp, 0);
    return {P, ev, held, cost, mv, ttmG, missing, ttmCash, fwd, fwdTax, fwdAnn, fwdProj: fwd + fwdTax - fwdAnn, all, drp, month: fwd / 12};
  }

  /* ---------- 图表工具 ---------- */
  function niceTicks(lo, hi, n = 4){
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / p;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
    const t = [], end = Math.ceil(hi / step - 1e-9) * step;
    for (let v = Math.floor(lo / step + 1e-9) * step; v <= end + step * 1e-6; v += step) t.push(+v.toFixed(10));
    return {t, step};
  }
  function tipAt(box, tip, x, html){
    tip.innerHTML = html; tip.style.opacity = 1;
    const w = tip.offsetWidth, W = box.clientWidth;
    tip.style.left = Math.max(0, Math.min(W - w, x + (x + 14 + w > W ? -w - 14 : 14))) + "px"; tip.style.top = "6px";
  }
  function hoverLayer(box, svg, xs, onIdx){
    const tip = document.createElement("div"); tip.className = "tip"; box.appendChild(tip);
    const hit = svg.querySelector(".hit"), cross = svg.querySelector(".cross"), dot = svg.querySelector(".hdot");
    const move = e => {
      const r = svg.getBoundingClientRect(), x = e.clientX - r.left;
      let i = 0, best = Infinity; xs.forEach((v, j) => { const d = Math.abs(v - x); if (d < best) { best = d; i = j; } });
      const res = onIdx(i); if (!res) return;
      if (cross) { cross.setAttribute("x1", xs[i]); cross.setAttribute("x2", xs[i]); cross.style.opacity = 1; }
      if (dot && res.y != null) { dot.setAttribute("cx", xs[i]); dot.setAttribute("cy", res.y); dot.style.opacity = 1; }
      tipAt(box, tip, xs[i], res.html);
    };
    const leave = () => { tip.style.opacity = 0; if (cross) cross.style.opacity = 0; if (dot) dot.style.opacity = 0; };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
  }
  const yearTicks = (pts, X) => {
    const ks = pts.map(p => p.k), yrs = [...new Set(ks.filter(k => k.endsWith("-01")).map(k => k.slice(0, 4)))];
    const every = yrs.length > 6 ? 2 : 1;
    return yrs.filter((y, i) => i % every === 0).map(y => { const i = ks.indexOf(y + "-01"); return `<text class="ax" x="${X(i)}" y="__B__" text-anchor="middle">${y}</text>`; }).join("");
  };

  function chartDY(box, s){
    box.innerHTML = "";
    const all = series(s, S.exSp), pts = all.slice(-S.yrs * 12), st = stats(s, S.exSp);
    if (pts.length < 3 || !st) { box.innerHTML = `<div class="empty">数据不足，画不出股息率走势。</div>`; return; }
    const W = Math.max(280, box.clientWidth), H = 220, L = 44, R = 12, T = 12, B = 24;
    const lo = Math.max(0, Math.min(...pts.map(p => p.dy), st.mean - st.sd)), hi = Math.max(...pts.map(p => p.dy), st.mean + st.sd);
    const {t} = niceTicks(lo * 0.95, hi * 1.05);
    const y0 = t[0], y1 = t[t.length - 1];
    const X = i => L + (pts.length === 1 ? 0 : i * (W - L - R) / (pts.length - 1)), Y = v => T + (y1 - v) * (H - T - B) / (y1 - y0 || 1);
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.dy).toFixed(1)}`).join(" ");
    const last = pts.length - 1, bandLo = Math.max(y0, st.mean - st.sd), bandHi = Math.min(y1, st.mean + st.sd);
    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} 过去 ${f(pts.length / 12, 0)} 年 TTM 股息率走势，现在 ${pc(st.cur)}，平均 ${pc(st.mean)}">
      ${t.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${f(v * 100, v * 100 % 1 ? 1 : 0)}%</text>`).join("")}
      <rect x="${L}" y="${Y(bandHi)}" width="${W - L - R}" height="${Math.max(0, Y(bandLo) - Y(bandHi))}" style="fill:var(--c1);fill-opacity:.1"/>
      <line x1="${L}" x2="${W - R}" y1="${Y(st.mean)}" y2="${Y(st.mean)}" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:5 4"/>
      <text class="lab" x="${L + 6}" y="${Y(st.mean) - 5}">平均 ${pc(st.mean)}</text>
      <polyline points="${line}" fill="none" style="stroke:var(--c1);stroke-width:2;stroke-linejoin:round"/>
      <circle cx="${X(last)}" cy="${Y(pts[last].dy)}" r="5" style="fill:var(--c1);stroke:var(--panel);stroke-width:2"/>
      <text class="lab" x="${X(last) - 8}" y="${Y(pts[last].dy) + (Y(pts[last].dy) < T + 16 ? 16 : -9)}" text-anchor="end" style="font-weight:700">现在 ${pc(st.cur)}</text>
      ${yearTicks(pts, X).replace(/__B__/g, H - 6)}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--muted);stroke-width:1;opacity:0"/>
      <circle class="hdot" r="4" cx="0" cy="0" style="fill:var(--c1);stroke:var(--panel);stroke-width:2;opacity:0"/>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
    hoverLayer(box, box.querySelector("svg"), pts.map((p, i) => X(i)), i => ({y: Y(pts[i].dy),
      html: `${pts[i].k}<br>股息率 <b>${pc(pts[i].dy)}</b><br>收盘 <b>${px(pts[i].px)}</b>`}));
  }

  function chartPx(box, s, M){
    box.innerHTML = "";
    const m = (s.m || []).map(([k, v]) => ({k, v})).filter(p => p.k <= CUR);
    if (m.length && ok(s.last)) m[m.length - 1].v = m[m.length - 1].k === CUR ? s.last : m[m.length - 1].v;
    const pts = m.slice(-S.yrs * 12);
    if (pts.length < 3) { box.innerHTML = `<div class="empty">数据不足。</div>`; return; }
    const tr = trades().filter(t => t.code === s.code && t.date.slice(0, 7) >= pts[0].k);
    const W = Math.max(280, box.clientWidth), H = 220, L = 44, R = 12, T = 12, B = 24;
    const vals = pts.map(p => p.v).concat(tr.map(t => t.px));
    const {t} = niceTicks(Math.min(...vals) * 0.95, Math.max(...vals) * 1.05);
    const y0 = t[0], y1 = t[t.length - 1];
    const X = i => L + i * (W - L - R) / (pts.length - 1), Y = v => T + (y1 - v) * (H - T - B) / (y1 - y0 || 1);
    const t0 = toD(pts[0].k + "-15"), t1 = toD(pts[pts.length - 1].k + "-15");
    const XD = d => L + Math.max(0, Math.min(1, (toD(d) - t0) / (t1 - t0 || 1))) * (W - L - R);
    const mk = tr.map(q => { const x = XD(q.date), y = Y(q.px), up = q.side !== "S";
      return `<path d="${up ? `M${x},${y - 6} L${x + 5.5},${y + 4} L${x - 5.5},${y + 4} Z` : `M${x},${y + 6} L${x + 5.5},${y - 4} L${x - 5.5},${y - 4} Z`}" style="fill:${up ? "var(--c2)" : "var(--muted)"};stroke:var(--panel);stroke-width:1.5"><title>${q.date} ${q.side === "S" ? "卖出" : q.side === "DRP" ? "DRP" : "买入"} ${f(q.qty, 0)} 股 @ ${px(q.px)}</title></path>`; }).join("");
    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} 月收盘价与买卖点">
      ${t.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${px(v)}</text>`).join("")}
      <polyline points="${pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(--c1);stroke-width:2;stroke-linejoin:round"/>
      ${yearTicks(pts, X).replace(/__B__/g, H - 6)}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--muted);stroke-width:1;opacity:0"/>
      <circle class="hdot" r="4" cx="0" cy="0" style="fill:var(--c1);stroke:var(--panel);stroke-width:2;opacity:0"/>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>${mk}</svg>`;
    hoverLayer(box, box.querySelector("svg"), pts.map((p, i) => X(i)), i => {
      const ts = tr.filter(q => q.date.slice(0, 7) === pts[i].k);
      return {y: Y(pts[i].v), html: `${pts[i].k}<br>收盘 <b>${px(pts[i].v)}</b>${ts.map(q => `<br>${q.side === "S" ? "卖出" : q.side === "DRP" ? "DRP" : "买入"} ${f(q.qty, 0)} 股 @ <b>${px(q.px)}</b>`).join("")}`};
    });
  }

  function monthBuckets(ev){
    const b = {};
    ev.forEach(e => { const k = e.pay.slice(0, 7), o = b[k] || (b[k] = {paid:0, other:0, items:[]}); if (e.status === "paid") o.paid += e.cash; else o.other += e.cash; o.items.push(e); });
    return b;
  }
  function chartMonths(box, M){
    box.innerHTML = "";
    const c = cfg(), b = monthBuckets(M.ev), ks = []; for (let i = -11; i <= 12; i++) ks.push(addM(CUR, i));
    if (!M.held.length && !M.ev.length) { box.innerHTML = `<div class="empty">记下第一笔买入后，这里会画出每个月的股息。</div>`; return; }
    const W = Math.max(280, box.clientWidth), H = 220, L = 52, R = 10, T = 14, B = 26;
    const vals = ks.map(k => (b[k] ? b[k].paid + b[k].other : 0));
    const {t} = niceTicks(0, Math.max(...vals, c.target || 0) * 1.08 || 1);
    const y1 = t[t.length - 1], bw = (W - L - R) / ks.length, gap = Math.max(2, bw * 0.22);
    const X = i => L + i * bw, Y = v => T + (y1 - v) * (H - T - B) / y1;
    const bars = ks.map((k, i) => {
      const o = b[k] || {paid:0, other:0}, x = X(i) + gap / 2, w = bw - gap; let out = "";
      if (o.paid > 0) out += `<rect x="${x}" y="${Y(o.paid)}" width="${w}" height="${H - B - Y(o.paid)}" rx="2" style="fill:var(--c1)"/>`;
      if (o.other > 0) { const yb = o.paid > 0 ? Y(o.paid) - 2 : H - B, h = Math.max(1, (H - B - Y(o.other))); out += `<rect x="${x}" y="${yb - h}" width="${w}" height="${h}" rx="2" style="fill:var(--c2)"/>`; }
      const show = ((i - 11) % (W < 520 ? 3 : 2) + 6) % (W < 520 ? 3 : 2) === 0;  // 以本月为基准等距显示
      out += show ? `<text class="ax" x="${x + w / 2}" y="${H - 9}" text-anchor="middle" style="${k === CUR ? "fill:var(--ink);font-weight:700" : ""}">${k.endsWith("-01") ? k.slice(2, 4) + "/1" : +k.slice(5)}</text>` : "";
      return out;
    }).join("");
    const tl = c.target > 0 && c.target <= y1 ? `<line x1="${L}" x2="${W - R}" y1="${Y(c.target)}" y2="${Y(c.target)}" style="stroke:var(--muted);stroke-width:1.5;stroke-dasharray:5 4"/><text class="lab" x="${W - R}" y="${Y(c.target) - 5}" text-anchor="end">目标 ${rm(c.target, 0)}</text>` : "";
    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="过去 12 个月与未来 12 个月每月股息">
      ${t.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v >= 1000 ? f(v / 1000, v % 1000 ? 1 : 0) + "k" : f(v, 0)}</text>`).join("")}
      <line x1="${X(11) + bw}" x2="${X(11) + bw}" y1="${T}" y2="${H - B}" style="stroke:var(--line);stroke-width:1"/>
      ${bars}${tl}
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
    hoverLayer(box, box.querySelector("svg"), ks.map((k, i) => X(i) + bw / 2), i => {
      const k = ks[i], o = b[k] || {paid:0, other:0, items:[]};
      const top = o.items.slice().sort((a, z) => z.cash - a.cash).slice(0, 4).map(e => `<br>${esc(e.s.name)} ${rm(e.cash)}${e.status !== "paid" ? "（" + ST[e.status] + "）" : ""}`).join("");
      return {html: `<b>${k}</b><br><span class="k" style="background:var(--c1)"></span>已到账 <b>${rm(o.paid)}</b><br><span class="k" style="background:var(--c2)"></span>待发放/预估 <b>${rm(o.other)}</b>${top}`};
    });
  }

  /* ---------- 渲染：总览 ---------- */
  function renderOverview(M){
    const c = cfg(), has = M.held.length > 0;
    $("k-month").innerHTML = has ? `${rm(M.month)}<small>/ 月</small>` : "—";
    $("k-month2").innerHTML = has ? `未来 12 个月税后股息 ${rm(M.fwd)} ÷ 12` : `还没有持股。到「我的持股」记下买入记录，或先 <button class="btn" type="button" data-demo="on">用示例持股看效果</button>`;
    const cov = c.target > 0 ? M.month / c.target : null;
    $("k-covbar").style.width = (cov ? Math.min(100, cov * 100) : 0) + "%";
    $("k-cov").textContent = "目标覆盖率 " + (cov != null && has ? pc(cov, 1) : "—");
    $("k-target").textContent = "目标每月 " + rm(c.target, 0);
    $("k-cost").textContent = has ? rm(M.cost) : "—";
    $("k-cost2").textContent = has ? `${M.held.length} 只股票` : "";
    $("k-mv").textContent = has ? rm(M.mv) : "—";
    const u = M.mv - M.cost; $("k-mv2").innerHTML = has ? `未实现 <span class="${cls(u)}">${sRm(u)}（${pc(M.cost ? u / M.cost : null, 1)}）</span>` : "";
    $("k-ttm").textContent = has || M.ttmCash ? rm(M.ttmCash) : "—";
    $("k-ttm2").textContent = has ? `按到账日 ${addDays(TODAY, -365)} 起` : "";
    $("k-dy").textContent = M.mv > 0 ? pc(M.ttmG / M.mv) : "—";
    $("k-yoc").textContent = M.cost > 0 ? pc(M.ttmG / M.cost) : "—";
    $("k-all").textContent = M.all ? rm(M.all) : "—";
    $("k-all2").textContent = M.drp ? `另有 DRP 再投资 ${rm(M.drp)}` : "现金股息，已扣 REIT 预扣税";
  }

  /* ---------- 渲染：年 × 月收入表 ---------- */
  function renderYearTable(M){
    const c = cfg();
    $("yt-h").innerHTML = `<tr><th>年份</th>${[...Array(12)].map((_, i) => `<th>${i + 1}月</th>`).join("")}<th>合计</th><th>年增长</th></tr>`;
    if (!M.ev.length) { $("yt-b").innerHTML = `<tr><td colspan="15" class="empty" style="text-align:center">还没有股息记录。记下买入后，过去拿到的和未来预计的股息会按月份排在这里。</td></tr>`; $("yt-note").textContent = ""; return; }
    const hiPay = addDays(TODAY, 365);
    const ev = M.ev.filter(e => e.status === "paid" || e.pay <= hiPay);
    const years = [...new Set(ev.map(e => e.pay.slice(0, 4)))].sort();
    let prevTot = null; const rows = [];
    for (const y of years) {
      const ye = ev.filter(e => e.pay.startsWith(y)), tax = taxOn(ye);
      const cells = [...Array(12)].map((_, i) => {
        const k = `${y}-${String(i + 1).padStart(2, "0")}`, es = ye.filter(e => e.pay.startsWith(k));
        if (!es.length) return `<td class="num e">–</td>`;
        const paid = es.filter(e => e.status === "paid").reduce((a, e) => a + e.cash, 0), oth = es.filter(e => e.status !== "paid").reduce((a, e) => a + e.cash, 0);
        const ttl = es.map(e => `${e.s.name} ${rm(e.cash)}（${ST[e.status]}）`).join("\n");
        return `<td class="num ${paid ? "" : "p"}" title="${esc(ttl)}">${paid && oth ? f(paid + oth) + "*" : f(paid + oth)}</td>`;
      }).join("");
      const tot = ye.reduce((a, e) => a + e.cash, 0) - tax, drp = ye.reduce((a, e) => a + e.drp, 0);
      const partial = ye.some(e => e.status !== "paid");
      const gr = prevTot > 0 ? tot / prevTot - 1 : null;
      rows.push(`<tr class="${y === TODAY.slice(0, 4) ? "cur" : ""}"><td>${y}${partial ? (y > TODAY.slice(0, 4) ? " 预估" : " 含预估") : ""}</td>${cells}
        <td class="num tot ${partial ? "" : ""}" title="${esc((tax ? `已扣股息税 ${rm(tax)}` : "") + (drp ? `\nDRP 再投资 ${rm(drp)}（不计入现金）` : ""))}">${f(tot)}</td>
        <td class="num ${cls(gr)}">${gr == null || y > TODAY.slice(0, 4) ? "—" : (gr > 0 ? "+" : "") + pc(gr, 1)}</td></tr>`);
      if (y <= TODAY.slice(0, 4)) prevTot = tot;
    }
    $("yt-b").innerHTML = rows.join("");
    $("yt-note").textContent = `单位 RM，税后现金。REIT 已扣 ${c.wht}% 预扣税${c.tax ? `；年合计已扣股息税（一般股票股息超过 ${rm(c.taxTh, 0)} 的部分 × ${c.taxR}%）` : ""}。斜体 = 待发放或预估，带 * 的月份同时有已到账和待发放。鼠标停在格子上可看明细。` + (M.drp ? `累计 DRP 再投资 ${rm(M.drp)} 不计入现金。` : "");
  }

  /* ---------- 渲染：生活费 ---------- */
  function universeYield(){
    const ys = S.list.filter(s => ok(s.last)).map(s => ttm(s, TODAY, true) / s.last).filter(v => v > 0).sort((a, b) => b - a).slice(0, 10);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  }
  function renderLiving(M){
    const c = cfg(), has = M.held.length > 0;
    $("li-meta").textContent = `目标每月 ${rm(c.target, 0)} · 在页面底部的设置里修改`;
    $("l-year").textContent = has ? rm(M.fwd) : "—";
    $("l-year2").textContent = has ? `已宣布 ${rm(M.fwdAnn)} · 按去年同期预估 ${rm(M.fwdProj)}${M.fwdTax ? ` · 已扣股息税 ${rm(M.fwdTax)}` : ""}` : "还没有持股。";
    $("l-month").textContent = has ? `${rm(M.month)} / 月` : "—";
    $("l-day").textContent = has ? `每天 ${rm(M.fwd / 365)} · 覆盖目标 ${c.target > 0 ? pc(M.month / c.target, 1) : "—"}` : "";
    const gap = c.target * 12 - (has ? M.fwd : 0);
    const yNet = has && M.mv > 0 && M.fwd > 0 ? M.fwd / M.mv : null, yU = universeYield();
    const y = yNet || yU;
    if (gap <= 0 && has) { $("l-need").textContent = "已经够了"; $("l-need2").textContent = `股息已覆盖目标生活费，多出每年 ${rm(-gap)}。`; }
    else if (y) { $("l-need").textContent = "再投入 " + rm(gap / y, 0); $("l-need2").textContent = yNet ? `按目前组合的税后股息率 ${pc(yNet)} 计算，每年还差 ${rm(gap, 0)}。` : `还没有持股，按高息榜前 10 名平均股息率 ${pc(yU)}（税前）估算，每年需要 ${rm(gap, 0)}。`; }
    else { $("l-need").textContent = "—"; $("l-need2").textContent = ""; }
    if (!has) { $("l-thin").innerHTML = ""; $("l-thin2").textContent = "有持股后，这里会列出未来 12 个月里股息特别少的月份。"; return; }
    const b = monthBuckets(M.ev), ks = []; for (let i = 1; i <= 12; i++) ks.push(addM(CUR, i));
    const v = ks.map(k => b[k] ? b[k].paid + b[k].other : 0), avg = M.fwd / 12, thr = Math.min(avg, c.target || avg) * 0.5;
    const thin = ks.filter((k, i) => v[i] < thr);
    $("l-thin").innerHTML = thin.length ? thin.map(k => `<span>${k.slice(0, 4)} 年 ${mLabel(k)} · ${rm(b[k] ? b[k].paid + b[k].other : 0, 0)}</span>`).join("") : `<span style="background:var(--accent-soft);color:var(--accent)">每个月都有一定股息进账</span>`;
    $("l-thin2").textContent = thin.length ? `这些月份的股息低于月均的一半（${rm(thr, 0)}），生活费要靠其他月份存下来，或考虑在这些月份派息的股票。` : "";
  }

  /* ---------- 渲染：派息日历 ---------- */
  function renderPayCal(M){
    const box = $("pc-box"), lo = addDays(TODAY, -60), hi = addDays(TODAY, 365);
    const ev = M.ev.filter(e => e.pay >= lo && e.pay <= hi);
    if (!ev.length) { box.innerHTML = `<div class="panel empty">${M.held.length ? "未来一年没有找到派息。" : "还没有持股。记下买入后，这里会列出每一笔派息。"}</div>`; return; }
    if (S.pcv === "list") {
      box.innerHTML = `<div class="panel tw"><table style="min-width:760px"><thead><tr><th>发放日</th><th>股票</th><th>除息日</th><th style="text-align:right">每股</th><th style="text-align:right">股数</th><th style="text-align:right">应得（税后）</th><th>状态</th></tr></thead><tbody>${ev.map(e =>
        `<tr class="${e.status === "proj" ? "proj" : ""} ${e.pay < TODAY ? "past" : ""}"><td class="dd">${e.pay}${e.payEst ? " 估" : ""}</td><td>${esc(e.s.name)} <span class="z num">${esc(e.code)}</span>${e.sp ? '<span class="tag sp">特别</span>' : ""}</td><td class="dd">${e.ex}</td><td class="num" style="text-align:right">${dps(e.amt)}</td><td class="num" style="text-align:right">${f(e.sh, 0)}</td><td class="num" style="text-align:right">${rm(e.cash)}${e.drp ? `<br><span class="z" style="font-size:.72rem">DRP ${rm(e.drp)}</span>` : ""}</td><td><span class="st ${e.status}">${ST[e.status]}</span></td></tr>`).join("")}</tbody></table></div>`;
      return;
    }
    const ks = []; for (let i = 0; i < 12; i++) ks.push(addM(CUR, i));
    box.innerHTML = `<div class="mcal">${ks.map(k => { const es = ev.filter(e => e.pay.startsWith(k)), tot = es.reduce((a, e) => a + e.cash, 0);
      return `<div class="panel mc ${es.length ? "" : "none"}"><div class="h"><b>${k.slice(0, 4)} 年 ${mLabel(k)}</b><span>${es.length ? rm(tot) : "—"}</span></div>
        <ul>${es.map(e => `<li class="${e.status === "proj" ? "proj" : ""}"><span>${e.pay.slice(8)}日 ${esc(e.s.name)}</span><span class="num">${rm(e.cash)} · ${ST[e.status]}</span></li>`).join("") || "<li>没有派息</li>"}</ul></div>`; }).join("")}</div>`;
  }

  /* ---------- 渲染：我的持股 + 买卖记录 ---------- */
  function renderPositions(M){
    const rows = M.held.map(p => { const s = S.by[p.code]; return {p, s, mv: s && ok(s.last) ? p.qty * s.last : null}; }).sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1));
    $("pos").innerHTML = rows.length ? rows.map(({p, s, mv}) => {
      const avg = p.cost / p.qty, unr = mv == null ? null : mv - p.cost, dpsT = s ? ttm(s, TODAY, S.exSp) : null;
      const nx = M.ev.find(e => e.code === p.code && e.pay > TODAY);
      return `<tr data-code="${esc(p.code)}"><td><b>${esc(s ? s.name : p.code)}</b> <span class="z num">${esc(p.code)}</span>${s && s.type === "reit" ? '<span class="tag reit">REIT</span>' : ""}</td>
        <td class="num" style="text-align:right">${qty(p.qty)}</td><td class="num" style="text-align:right">${px(avg)}</td><td class="num" style="text-align:right">${rm(p.cost)}</td>
        <td class="num" style="text-align:right">${s ? px(s.last) : "—"}</td><td class="num" style="text-align:right">${rm(mv)}</td>
        <td class="num ${cls(unr)}" style="text-align:right">${sRm(unr)}<br><span style="font-size:.72rem">${pc(unr / p.cost, 1)}</span></td>
        <td class="num" style="text-align:right">${s && ok(s.last) ? pc(dpsT / s.last) : "—"}</td><td class="num" style="text-align:right">${pc(dpsT / avg)}</td>
        <td>${nx ? `<span class="num">${nx.pay.slice(5)}</span> ${rm(nx.cash)} <span class="st ${nx.status}">${ST[nx.status]}</span>` : "—"}</td></tr>`;
    }).join("") : `<tr><td colspan="10" class="empty" style="text-align:center">还没有买卖记录。展开下方「买卖记录」新增第一笔。</td></tr>`;
    const T = trades().reverse();
    $("t-count").textContent = T.length ? `${T.length} 笔 · 展开` : "展开";
    $("tlist").innerHTML = T.length ? T.map(t => { const s = S.by[t.code];
      return `<tr><td class="dd">${t.date}</td><td>${esc(s ? s.name : t.code)} <span class="z num">${esc(t.code)}</span></td><td>${t.side === "S" ? "卖出" : t.side === "DRP" ? "DRP" : "买入"}</td>
        <td class="num" style="text-align:right">${f(t.qty, 0)}</td><td class="num" style="text-align:right">${px(t.px)}</td><td class="num" style="text-align:right">${t.fee ? f(t.fee) : "—"}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn" type="button" data-te="${esc(t.id)}">修改</button> <button class="btn danger" type="button" data-td="${esc(t.id)}">${S.delArm === t.id ? "确认删除" : "删除"}</button></td></tr>`; }).join("")
      : `<tr><td colspan="7" class="z" style="font-size:.84rem">还没有记录。</td></tr>`;
  }
  function fillCodes(){
    const opts = [...S.list].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${esc(s.code)}">${esc(s.name)} · ${esc(s.code)}${s.type === "reit" ? " · REIT" : ""}</option>`).join("");
    $("t-code").innerHTML = opts; $("sk-sel").innerHTML = opts;
    if (!$("t-date").value) $("t-date").value = TODAY;
  }
  $("tf").addEventListener("submit", e => {
    e.preventDefault();
    const code = $("t-code").value, date = $("t-date").value, side = $("t-side").value;
    const p = parseFloat($("t-px").value), q = parseFloat($("t-qty").value), fee = parseFloat($("t-fee").value) || 0;
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(p >= 0) || !(q > 0)) { $("t-msg").textContent = "请填写股票、日期、价格和股数。"; return; }
    if (date > TODAY) { $("t-msg").textContent = "日期不能晚于今天。"; return; }
    const others = S.st.trades.filter(t => t.id !== S.editId);
    if (side === "S") {
      const held = others.filter(t => t.code === code && t.date <= date).reduce((a, t) => a + (t.side === "S" ? -t.qty : t.qty), 0);
      if (q > held + 1e-9) { $("t-msg").textContent = `${date} 当天你只持有 ${f(held, 0)} 股，不能卖出 ${f(q, 0)} 股。`; return; }
    }
    if (S.demo) { $("t-msg").textContent = "示例模式下不会保存。先点页面顶部的「退出示例」，再记下你自己的买卖。"; return; }
    const id = S.editId || ("t" + Date.now().toString(36));
    S.st.trades = others.concat([{id, code, date, side, px:p, qty:q, fee, note:""}]);
    const okSave = save();
    $("t-msg").textContent = okSave ? `已保存：${date} ${side === "S" ? "卖出" : side === "DRP" ? "DRP" : "买入"} ${S.by[code] ? S.by[code].name : code} ${f(q, 0)} 股` : "已更新页面，但浏览器不允许保存（可能是无痕模式），刷新后会丢失。";
    $("tf").reset(); $("t-date").value = TODAY; S.editId = null; $("t-save").textContent = "保存";
    if (!S.sel || !trades().some(t => t.code === S.sel)) S.sel = code;
    renderAll();
  });
  $("tlist").addEventListener("click", e => {
    const ed = e.target.closest("[data-te]"), dl = e.target.closest("[data-td]");
    if (ed) { const t = S.st.trades.find(x => x.id === ed.dataset.te); if (!t) return;
      S.editId = t.id; $("t-code").value = t.code; $("t-date").value = t.date; $("t-side").value = t.side; $("t-px").value = t.px; $("t-qty").value = t.qty; $("t-fee").value = t.fee || "";
      $("t-save").textContent = "保存修改"; $("t-msg").textContent = `正在修改 ${t.date} 的记录`; $("t-px").focus(); }
    if (dl) { const id = dl.dataset.td; if (S.delArm !== id) { S.delArm = id; renderPositions(S.M); return; }
      S.delArm = null; if (S.demo) { $("t-msg").textContent = "示例模式下不能删除。"; return; } S.st.trades = S.st.trades.filter(t => t.id !== id); save(); $("t-msg").textContent = "已删除"; renderAll(); }
  });
  $("pos").addEventListener("click", e => { const tr = e.target.closest("tr[data-code]"); if (tr) selectStock(tr.dataset.code, true); });

  /* ---------- 渲染：高息榜 ---------- */
  const COLS = [["name", "股票", "left"], ["px", "现价"], ["dy", "TTM 股息率"], ["m5", "近 5 年平均"], ["pct", "历史百分位"], ["fq", "派息频率", "left"], ["nx", "下次除息（预计）", "left"]];
  function renderRank(M){
    const held = new Set(M.held.map(p => p.code));
    const rows = S.list.map(s => { const st = stats(s, S.exSp); return {s, st, dy: ok(s.last) ? ttm(s, TODAY, S.exSp) / s.last : null, held: held.has(s.code)}; })
      .filter(r => S.rf === "all" || (S.rf === "mine" ? r.held : r.s.type === S.rf));
    const k = S.sort.k, dir = S.sort.dir;
    const val = r => k === "name" ? r.s.name : k === "px" ? r.s.last : k === "dy" ? r.dy : k === "m5" ? r.st && r.st.m5 : k === "pct" ? r.st && r.st.pct : k === "fq" ? freq(r.s) : k === "nx" ? (nextEx(r.s) || {}).date || "9" : 0;
    rows.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
    $("rk-h2").innerHTML = `<tr><th style="width:2.2em">#</th>${COLS.map(([c, l, al]) => `<th style="text-align:${al || "right"}"><button type="button" data-sort="${c}" ${k === c ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}${k === c ? (dir > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr>`;
    $("rk-b").innerHTML = rows.length ? rows.map((r, i) => {
      const st = r.st, pos = st ? Math.round(st.pct * 100) : null;
      return `<tr data-code="${esc(r.s.code)}"><td class="z num">${i + 1}</td><td><b>${esc(r.s.name)}</b> <span class="z num">${esc(r.s.code)}</span>${r.s.type === "reit" ? '<span class="tag reit">REIT</span>' : ""}${r.held ? '<span class="tag">持有</span>' : ""}</td>
        <td class="num" style="text-align:right">${px(r.s.last)}</td><td class="num" style="text-align:right;font-weight:700">${pc(r.dy)}</td><td class="num" style="text-align:right">${st ? pc(st.m5) : "—"}</td>
        <td style="text-align:right">${st ? `<span class="pbar"><i><b style="left:calc(${pos}% - 1.5px)"></b></i><span class="num">${pos}</span></span>` : "—"}</td>
        <td>${freq(r.s)}</td><td>${nextExTxt(r.s)}</td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty" style="text-align:center">${S.rf === "mine" ? "你还没有持有名单里的股票。" : "没有符合条件的股票。"}</td></tr>`;
    $("rk-meta").textContent = `${S.list.length} 只 · 马股收盘 ${S.data ? S.data.priceAsOf : ""}`;
  }
  $("rk-h2").addEventListener("click", e => { const b = e.target.closest("[data-sort]"); if (!b) return; const k = b.dataset.sort;
    S.sort = {k, dir: S.sort.k === k ? -S.sort.dir : (k === "name" || k === "fq" || k === "nx" ? 1 : -1)}; renderRank(S.M); });
  $("rk-b").addEventListener("click", e => { const tr = e.target.closest("tr[data-code]"); if (tr) selectStock(tr.dataset.code, true); });
  $("rk-f").addEventListener("click", e => { const b = e.target.closest("[data-rf]"); if (!b) return; S.rf = b.dataset.rf;
    [...$("rk-f").children].forEach(x => x.setAttribute("aria-pressed", x === b)); renderRank(S.M); });
  $("rk-sp").addEventListener("click", () => { S.exSp = !S.exSp; $("rk-sp").setAttribute("aria-pressed", S.exSp); renderAll(); });

  /* ---------- 渲染：个股 ---------- */
  function selectStock(code, scroll){ S.sel = code; S.more = false; $("sk-sel").value = code; renderStock(S.M); if (scroll) $("stock").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); }
  function renderStock(M){
    const s = S.by[S.sel]; if (!s) return;
    $("sk-sel").value = s.code;
    const st = stats(s, S.exSp);
    if (st) {
      const y = Math.min(10, Math.max(1, Math.round(st.years))), p = Math.round(st.pct * 100);
      const word = p >= 80 ? "偏高（股价相对便宜）" : p >= 60 ? "略高于平均" : p > 40 ? "接近历史中间" : p > 20 ? "略低于平均" : "偏低（股价相对贵）";
      $("sk-v").innerHTML = `目前 DY <span class="num">${pc(st.cur)}</span>，处于过去 ${y} 年第 <span class="num">${p}</span> 百分位，${word}。平均 <span class="num">${pc(st.mean)}</span>，±1 标准差 <span class="num">${pc(Math.max(0, st.mean - st.sd))}–${pc(st.mean + st.sd)}</span>。`;
    } else $("sk-v").textContent = "数据不足，无法计算历史位置。";
    chartDY($("ch-dy"), s); chartPx($("ch-px"), s, M);
    const dv = [...s.divs].reverse(), show = S.more ? dv : dv.slice(0, 12);
    $("sk-dv").innerHTML = show.length ? show.map(d => { const p = priceAt(s, d.ex), t = ttm(s, d.ex, S.exSp);
      const notes = [d.type, d.sp ? "疑似特别股息" : "", d.ex > TODAY ? "已宣布" : d.payE > TODAY ? "待发放" : "", d.parts ? `分 ${d.parts.length} 笔：${d.parts.map(dps).join(" + ")}` : "", d.saAmt ? `另一来源 ${dps(d.saAmt)}` : ""].filter(Boolean).join(" · ");
      return `<tr class="${d.ex > TODAY ? "" : ""}"><td class="dd">${d.ex}</td><td class="dd">${d.rec || "—"}</td><td class="dd">${d.pay || (d.payE ? d.payE + " 估" : "—")}</td>
        <td class="num" style="text-align:right">${dps(d.amt)}${d.sp ? '<span class="tag sp">特别</span>' : ""}</td><td class="num" style="text-align:right">${p ? pc(t / p) : "—"}</td><td class="z" style="font-size:.78rem">${esc(notes) || ""}</td></tr>`; }).join("")
      : `<tr><td colspan="6" class="empty">没有派息记录。</td></tr>`;
    $("sk-more").hidden = dv.length <= 12; $("sk-more").textContent = S.more ? "只显示最近 12 笔" : `显示全部派息历史（${dv.length} 笔）`;
  }
  $("sk-sel").addEventListener("change", e => selectStock(e.target.value, false));
  $("sk-more").addEventListener("click", () => { S.more = !S.more; renderStock(S.M); });
  $("sk-r").addEventListener("click", e => { const b = e.target.closest("[data-y]"); if (!b) return; S.yrs = +b.dataset.y;
    [...$("sk-r").children].forEach(x => x.setAttribute("aria-pressed", x === b)); renderStock(S.M); });
  $("pcv").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (!b) return; S.pcv = b.dataset.v;
    [...$("pcv").children].forEach(x => x.setAttribute("aria-pressed", x === b)); renderPayCal(S.M); });

  /* ---------- 设置与备份 ---------- */
  function fillSettings(){ const c = cfg(); $("s-target").value = c.target; $("s-wht").value = c.wht; $("s-tax").checked = !!c.tax; $("s-taxth").value = c.taxTh; $("s-taxr").value = c.taxR; }
  $("sf").addEventListener("submit", e => {
    e.preventDefault();
    const n = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : d; };
    S.st.settings = {target: n("s-target", DEF.target), wht: Math.min(100, n("s-wht", DEF.wht)), tax: $("s-tax").checked, taxTh: n("s-taxth", DEF.taxTh), taxR: Math.min(100, n("s-taxr", DEF.taxR))};
    if (S.demo) { const real = AS.loadDiv(); real.settings = S.st.settings; AS.saveDiv(real); } else save();
    $("io-msg").textContent = "设置已保存。"; renderAll();
  });
  $("io-export").addEventListener("click", async () => {
    const txt = AS.exportAll(); $("io-text").value = txt;  // 导出的是保存的真实记录，不含示例
    try { await navigator.clipboard.writeText(txt); $("io-msg").textContent = "已复制到剪贴板，也显示在上面的输入框里。"; }
    catch(e){ $("io-text").select(); $("io-msg").textContent = "已显示在输入框里，请手动复制。"; }
  });
  $("io-import").addEventListener("click", () => {
    const r = AS.importAll($("io-text").value); $("io-msg").textContent = r.msg;
    if (r.ok) { S.demo = false; $("demo-bar").hidden = true; S.st = AS.loadDiv(); fillSettings(); renderAll(); }
  });

  /* ---------- 总渲染 ---------- */
  function renderCharts(){ if (!S.data) return; chartMonths($("ch-month"), S.M); const s = S.by[S.sel]; if (s) { chartDY($("ch-dy"), s); chartPx($("ch-px"), s, S.M); } }
  function renderAll(){
    if (!S.data) return;
    S.M = model();
    renderOverview(S.M); chartMonths($("ch-month"), S.M); renderYearTable(S.M); renderLiving(S.M);
    renderPayCal(S.M); renderPositions(S.M); renderRank(S.M); renderStock(S.M);
  }
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderCharts, 150); });

  fillSettings();
  fetch("dividends.json", {cache:"no-store"}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
    S.data = d; S.list = (d.stocks || []).filter(s => s && s.code).map(prep); S.list.forEach(s => S.by[s.code] = s);
    $("asof").textContent = `马股收盘 ${d.priceAsOf || "—"} · 更新于 ${(d.updatedAt || "").slice(5)}`;
    fillCodes();
    const P = positions(), held = Object.values(P).filter(p => p.qty > 0 && S.by[p.code]).sort((a, b) => b.cost - a.cost);
    S.sel = held.length ? held[0].code : (S.list.filter(s => ok(s.last)).sort((a, b) => ttm(b, TODAY, true) / b.last - ttm(a, TODAY, true) / a.last)[0] || S.list[0] || {}).code;
    renderAll();
  }).catch(() => {
    $("asof").textContent = "读不到 dividends.json";
    ["yt-b", "rk-b"].forEach(id => $(id).innerHTML = `<tr><td colspan="15" class="empty">读不到 dividends.json。请通过网址打开（不是直接双击文件），或稍后再试。</td></tr>`);
  });
})();
