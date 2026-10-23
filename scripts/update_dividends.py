#!/usr/bin/env python3
"""股息台每日数据更新（由 GitHub Actions 运行，只用 Python 标准库）。

读 dividend-tickers.json 和 dividend-overrides.json，写 dividends.json：
- 价格：Yahoo Finance（<code>.KL）月线（全部历史，保留最近 12 年）+ 近一年日线
- 股息：Yahoo 的除息日与每股金额（长历史）
         + stockanalysis.com 的登记日、发放日、已宣布但未除息的股息（近几年）
- 某只股票抓取失败时沿用上一次的数据，并在 err 里写明原因
"""
import datetime as dt
import html
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
MYT = dt.timezone(dt.timedelta(hours=8))
KEEP_YEARS = 12


def now_myt():
    return dt.datetime.now(MYT)


def ymd_ts(ts):
    return dt.datetime.fromtimestamp(int(ts), MYT).strftime("%Y-%m-%d")


def days_between(a, b):
    return (dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days


def get(url, tries=3):
    last = "unknown"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "text/html,application/json,*/*",
                "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code == 404:
                break
        except Exception as e:  # noqa: BLE001
            last = str(e)[:120]
        time.sleep(2 + 4 * i)
    raise RuntimeError(last)


def yahoo(sym, rng, interval):
    err = None
    for host in ("query1", "query2"):
        try:
            txt = get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}"
                      f"?range={rng}&interval={interval}&events=div%7Csplit")
            res = (json.loads(txt).get("chart") or {}).get("result") or []
            if res:
                return res[0]
            err = "empty result"
        except Exception as e:  # noqa: BLE001
            err = str(e)
    raise RuntimeError(f"Yahoo {rng}/{interval}: {err}")


def closes(res, fmt):
    ts = res.get("timestamp") or []
    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    cl = q.get("close") or []
    out = {}
    for t, c in zip(ts, cl):
        if c is None:
            continue
        k = ymd_ts(t)[:7] if fmt == "m" else ymd_ts(t)
        out[k] = round(float(c), 4)
    return sorted(out.items())


def yahoo_events(res):
    ev = res.get("events") or {}
    divs = {}
    for d in (ev.get("dividends") or {}).values():
        if d.get("amount") is None:
            continue
        ex = ymd_ts(d["date"])
        divs[ex] = round(divs.get(ex, 0) + float(d["amount"]), 6)
    splits = []
    for s in (ev.get("splits") or {}).values():
        splits.append({"date": ymd_ts(s["date"]), "ratio": s.get("splitRatio")
                       or f'{s.get("numerator")}:{s.get("denominator")}'})
    return sorted(divs.items()), sorted(splits, key=lambda x: x["date"])


def pdate(s):
    s = (s or "").strip()
    for f in ("%b %d, %Y", "%Y-%m-%d", "%d %b %Y"):
        try:
            return dt.datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def pnum(s):
    m = re.search(r"\d*\.?\d+", (s or "").replace(",", ""))
    return float(m.group()) if m else None


def stockanalysis(slug):
    """返回 [{ex, amt, rec, pay}]（同一除息日多笔会合并，parts 记录拆分）。"""
    t = get(f"https://stockanalysis.com/quote/klse/{slug}/dividend/")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) < 2:
            continue
        ex, amt = pdate(cells[0]), pnum(cells[1])
        if not ex or amt is None:
            continue
        rows.append({"ex": ex, "amt": amt,
                     "rec": pdate(cells[2]) if len(cells) > 2 else None,
                     "pay": pdate(cells[3]) if len(cells) > 3 else None})
    if not rows:
        raise RuntimeError(f"no dividend rows parsed (html {len(t)} bytes)")
    grouped = {}
    for r in rows:
        g = grouped.setdefault(r["ex"], {"ex": r["ex"], "amt": 0.0, "rec": r["rec"],
                                         "pay": r["pay"], "parts": []})
        g["amt"] = round(g["amt"] + r["amt"], 6)
        g["parts"].append(r["amt"])
        g["rec"] = g["rec"] or r["rec"]
        g["pay"] = g["pay"] or r["pay"]
    return list(grouped.values())


def merge(ydivs, sa_rows, ov):
    out = [{"ex": ex, "amt": amt, "src": "y"} for ex, amt in ydivs]
    for r in sa_rows or []:
        m = next((o for o in out if abs(days_between(o["ex"], r["ex"])) <= 4
                  and "sa" not in o["src"]), None)
        if m:
            for k in ("rec", "pay"):
                if r.get(k):
                    m[k] = r[k]
            if abs(m["amt"] - r["amt"]) > 0.05 * max(r["amt"], 1e-9):
                m["saAmt"] = r["amt"]
            if len(r["parts"]) > 1:
                m["parts"] = r["parts"]
            m["src"] = "y+sa"
        else:
            e = {"ex": r["ex"], "amt": r["amt"], "src": "sa"}
            for k in ("rec", "pay"):
                if r.get(k):
                    e[k] = r[k]
            if len(r["parts"]) > 1:
                e["parts"] = r["parts"]
            out.append(e)
    for ex, o in (ov or {}).items():
        m = next((x for x in out if x["ex"] == ex), None)
        if m is None and o.get("amt") is not None:
            m = {"ex": ex, "amt": float(o["amt"]), "src": "manual"}
            out.append(m)
        if m is None:
            continue
        for k in ("type", "special", "pay", "rec"):
            if k in o:
                m[k] = o[k]
        if o.get("amt") is not None:
            m["amt"] = float(o["amt"])
    return sorted(out, key=lambda x: x["ex"])


def main():
    tick = json.load(open(os.path.join(ROOT, "dividend-tickers.json"), encoding="utf-8"))
    try:
        ovs = json.load(open(os.path.join(ROOT, "dividend-overrides.json"), encoding="utf-8")).get("overrides", {})
    except FileNotFoundError:
        ovs = {}
    out_path = os.path.join(ROOT, "dividends.json")
    try:
        prev = {s["code"]: s for s in json.load(open(out_path, encoding="utf-8")).get("stocks", [])}
    except (FileNotFoundError, json.JSONDecodeError):
        prev = {}

    cutoff = str(now_myt().year - KEEP_YEARS)
    stocks, ok_price = [], 0
    for t in tick["stocks"]:
        code, ysym = t["code"], t.get("yahoo") or f'{t["code"]}.KL'
        s = {"code": code, "slug": t["slug"], "name": t["name"], "type": t.get("type", "stock"),
             "y": ysym, "err": []}
        old = prev.get(code, {})
        try:
            mres = yahoo(ysym, "max", "1mo")
            dres = yahoo(ysym, "1y", "1d")
            s["m"] = [[k, v] for k, v in closes(mres, "m") if k >= cutoff]
            s["d"] = [[k, v] for k, v in closes(dres, "d")]
            ydivs, splits = yahoo_events(mres)
            yd2, sp2 = yahoo_events(dres)  # 日线偶尔带上月线还没收录的最新一笔
            ydivs = sorted(dict(ydivs + yd2).items())
            s["splits"] = splits or sp2
            if not s["d"]:
                raise RuntimeError("Yahoo 没有日线收盘价")
            s["last"], s["lastDate"] = s["d"][-1][1], s["d"][-1][0]
            s["prev"] = s["d"][-2][1] if len(s["d"]) > 1 else None
            ok_price += 1
        except Exception as e:  # noqa: BLE001
            s["err"].append(f"价格：{e}")
            for k in ("m", "d", "splits", "last", "lastDate", "prev"):
                if k in old:
                    s[k] = old[k]
            ydivs = [(d["ex"], d["amt"]) for d in old.get("divs", []) if "y" in d.get("src", "")]
        time.sleep(1)
        try:
            sa = stockanalysis(t["slug"])
        except Exception as e:  # noqa: BLE001
            s["err"].append(f"派息日：{e}")
            sa = [{"ex": d["ex"], "amt": d.get("saAmt", d["amt"]), "rec": d.get("rec"),
                   "pay": d.get("pay"), "parts": d.get("parts", [d["amt"]])}
                  for d in old.get("divs", []) if "sa" in d.get("src", "")]
        s["divs"] = merge(ydivs, sa, ovs.get(code))
        if not s["err"]:
            del s["err"]
        stocks.append(s)
        print(f'{code:7} {t["slug"]:9} last={s.get("last")} m={len(s.get("m", []))} '
              f'divs={len(s["divs"])} pay={sum(1 for d in s["divs"] if d.get("pay"))} '
              f'err={s.get("err", "")}', flush=True)
        time.sleep(1)

    if ok_price == 0:
        print("所有股票的价格都抓取失败，不写入。", file=sys.stderr)
        sys.exit(1)
    data = {
        "updatedAt": now_myt().strftime("%Y-%m-%d %H:%M"),
        "priceAsOf": max((s.get("lastDate") or "") for s in stocks),
        "source": "价格与除息：Yahoo Finance；登记日、发放日与已宣布股息：stockanalysis.com；修正：dividend-overrides.json",
        "stocks": stocks,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"写入 {len(stocks)} 只股票，价格成功 {ok_price} 只，最新收盘 {data['priceAsOf']}")


if __name__ == "__main__":
    main()
