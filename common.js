/* 两个页面共用：浅木 / 胡桃配色切换，以及全站备份（美股持仓 + 股息台记录） */
(() => {
  "use strict";
  const K = {theme:"aaronsan.theme", div:"aaronsan.div", h:"aaronsan.holdings"};
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch(e){ return d; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch(e){ return false; } };

  function applyTheme(t){
    document.documentElement.dataset.theme = t;
    const b = document.getElementById("theme"); if (b) b.textContent = t === "dark" ? "胡桃" : "浅木";
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "dark" ? "#2B221B" : "#FAF6EF";
  }
  let theme = get(K.theme, "light"); applyTheme(theme);
  document.addEventListener("click", e => {
    if (!e.target.closest("#theme")) return;
    theme = theme === "dark" ? "light" : "dark"; applyTheme(theme); set(K.theme, theme);
    document.dispatchEvent(new CustomEvent("as-theme"));
  });

  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  function normTrades(arr){
    return (Array.isArray(arr) ? arr : []).filter(t => t && t.code && isDate(t.date) && isFinite(t.qty) && +t.qty > 0 && isFinite(t.px) && +t.px >= 0)
      .map((t, i) => ({id: String(t.id || ("t" + Date.now().toString(36) + i)), code: String(t.code).toUpperCase().trim(), date: t.date,
        side: t.side === "S" || t.side === "DRP" ? t.side : "B", px: +t.px, qty: +t.qty, fee: isFinite(t.fee) ? +t.fee : 0, note: t.note ? String(t.note).slice(0, 80) : ""}));
  }
  function normDiv(o){
    o = o && typeof o === "object" ? o : {};
    return {trades: normTrades(o.trades), settings: o.settings && typeof o.settings === "object" ? o.settings : {}};
  }
  function loadDiv(){ try { return normDiv(JSON.parse(get(K.div, "{}"))); } catch(e){ return normDiv({}); } }
  function saveDiv(o){ return set(K.div, JSON.stringify(o)); }
  function exportAll(){
    let h = []; try { h = JSON.parse(get(K.h, "[]")); } catch(e){}
    return JSON.stringify({v:2, exportedAt: new Date().toISOString().slice(0,10),
      holdings: (Array.isArray(h) ? h : []).map(({id, ...x}) => x), dividend: loadDiv()}, null, 1);
  }
  function normHoldings(arr){
    return (Array.isArray(arr) ? arr : []).filter(h => h && typeof h.sym === "string" && isFinite(h.qty) && isFinite(h.avg)).map(h => {
      const sym = h.sym.toUpperCase(), kind = h.kind === "OPT" ? "OPT" : "STK";
      const o = {sym, kind, qty:+h.qty, avg:+h.avg, updatedAt: new Date().toISOString().slice(0,10)};
      if (kind === "OPT") { o.strike = +h.strike; o.right = h.right === "CALL" ? "CALL" : "PUT"; o.expiry = String(h.expiry || ""); o.mark = isFinite(h.mark) && h.mark !== null ? +h.mark : null; }
      o.id = kind === "OPT" ? `${sym}-${o.strike}${o.right[0]}-${o.expiry}` : sym;
      return o;
    });
  }
  /* 导入全站备份：支持 v2 {holdings, dividend} 和旧版纯持仓数组 */
  function importAll(text){
    let o; try { o = JSON.parse(text); } catch(e){ return {ok:false, msg:"格式不对：请粘贴导出的完整 JSON。"}; }
    if (Array.isArray(o)) o = {holdings:o};
    if (!o || typeof o !== "object") return {ok:false, msg:"格式不对。"};
    const parts = [];
    if (Array.isArray(o.holdings)) { const h = normHoldings(o.holdings); set(K.h, JSON.stringify(h)); parts.push(`美股持仓 ${h.length} 笔`); }
    if (o.dividend) { const d = normDiv(o.dividend); saveDiv(d); parts.push(`股息台买卖记录 ${d.trades.length} 笔`); }
    return parts.length ? {ok:true, msg:"已导入：" + parts.join("，") + "。"} : {ok:false, msg:"没有找到可导入的内容。"};
  }
  window.AS = {K, get, set, loadDiv, saveDiv, normDiv, exportAll, importAll};
})();
