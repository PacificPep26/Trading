"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";

type Setup = { style: "bos" | "double_top_bottom"; state: "triggered" | "pending"; side: 1 | -1; entry: number; stop: number; tp15: number; tp2: number; distancePct: number; blocked?: string | null };
type WatchData = { coins: { coin: string; setups: Setup[]; lastBarTime: number; daily?: number }[]; btcDaily?: number };
type LevelsData = { rows: { coin: string; trend4h: number; trend1h: number }[]; computedAt: number };
type Tape = { price: number; bid: number; ask: number; bookBuy: number; tradeBuy: number; tradeVolume: number; ts: number };
type Trade = { ts: number; side: "buy" | "sell"; size: number };
type Key = "enter" | "wait" | "skip";
type Plan = {
  id: string; coin: string; kind: "4h"; side: 1 | -1; title: string; key: Key; text: string; reason: string;
  levels?: { entry: number; stop: number; tp1: number; tp2: number };
};

const emptyTape = (): Tape => ({ price: 0, bid: 0, ask: 0, bookBuy: 0.5, tradeBuy: 0.5, tradeVolume: 0, ts: 0 });
const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const clock = (v: number) => (v ? new Date(v).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const ORDER: Record<Key, number> = { enter: 0, wait: 1, skip: 2 };

// identical to rejection() in service/backtest/patterns.py

function targets(side: 1 | -1, price: number, stop: number, structural: number) {
  // agreed exit (PLAN.md): take the whole trade at 0.5R; 1.5R shown as the optional larger target
  const r = Math.abs(stop - price);
  void structural;
  return { entry: price, stop, tp1: price + side * 0.5 * r, tp2: price + side * 1.5 * r };
}

// 4h candles close at 00/04/08/12/16/20 UTC = 07/11/15/19/23/03 Vietnam time
function next4h(now: number) {
  const H4 = 4 * 3_600_000, close = Math.floor(now / H4) * H4 + H4, left = Math.max(0, close - now);
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000);
  const at = new Date(close).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
  return `nến 4h kế đóng lúc ${at} (còn ${h ? `${h}g` : ""}${m}p)`;
}

function fourHourPlan(coin: string, s: Setup, tape: Tape, lastBarTime: number, now: number): Plan {
  const title = s.style === "bos" ? "Phá cấu trúc (BOS) 4h" : "Hai đỉnh / hai đáy 4h";
  const base = { id: `${coin}-4h-${s.style}`, coin, kind: "4h" as const, side: s.side, title, levels: { entry: s.entry, stop: s.stop, tp1: s.entry + s.side * 0.5 * Math.abs(s.entry - s.stop), tp2: s.tp15 } };
  const p = tape.price;
  if (s.blocked) return { ...base, key: "skip", text: "KHÔNG ĐÁNH", reason: s.blocked };
  if (!p) return { ...base, key: "wait", text: "ĐANG LẤY GIÁ", reason: "Chờ WebSocket" };
  if (s.side > 0 ? p <= s.stop : p >= s.stop) return { ...base, key: "skip", text: "BỎ QUA", reason: "Giá đã vượt dừng lỗ" };
  if (s.state === "pending") {
    const crossed = s.side > 0 ? p > s.entry : p < s.entry;
    const dist = Math.abs(p / s.entry - 1);
    if (crossed) return { ...base, key: "wait", text: "CHỜ ĐÓNG 4H", reason: "Giá đã qua mức kích hoạt, cần nến 4h đóng cửa xác nhận" };
    const close = s.side > 0 ? "trên" : "dưới";
    return { ...base, key: "wait", text: dist <= 0.01 ? "SẮP KÍCH HOẠT" : "THEO DÕI", reason: `Chưa vào: cần nến 4h đóng ${close} ${fmt(s.entry)} (còn cách ${pct(dist)})` };
  }
  // triggered on the last closed 4h bar: valid until the next 4h bar closes
  const barClose = lastBarTime + 4 * 3_600_000;
  if (now - barClose > 4 * 3_600_000) return { ...base, key: "skip", text: "HẾT HẠN", reason: "Tín hiệu từ nến 4h trước, đã qua một nến" };
  const r0 = Math.abs(s.entry - s.stop);
  if (s.side * (p - s.entry) > 0.5 * r0) return { ...base, key: "skip", text: "ĐÃ CHẠY", reason: "Giá đã đi quá 0,5R từ điểm kích hoạt, không đuổi" };
  if (s.side * (p - (s.entry + s.side * 0.5 * Math.abs(s.entry - s.stop))) >= 0) return { ...base, key: "skip", text: "ĐÃ TỚI TP", reason: "Đã chạm chốt lời 0,5R" };
  return { ...base, key: "enter", text: "VÀO NGAY", reason: "Nến 4h vừa đóng xác nhận setup", levels: targets(s.side, p, s.stop, s.tp2) };
}

function beep() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* audio blocked until the user interacts with the page */ }
}

export default function LiveScanner() {
  const [watch, setWatch] = useState<WatchData | null>(null);
  const [levels, setLevels] = useState<LevelsData | null>(null);
  const [capital, setCapital] = useState(40); // margin per trade ($)
  const [lossUsd, setLossUsd] = useState(20); // $ lost if the stop is hit; leverage is derived from it
  useEffect(() => {
    const t = setTimeout(() => { try { const v = Number(localStorage.getItem("scanner-margin")); if (v > 0) setCapital(v); } catch { /* ignore */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  const [tapes, setTapes] = useState<Record<string, Tape>>({});
  const [connection, setConnection] = useState<"connecting" | "live" | "retrying">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [now, setNow] = useState(0);
  const tapeRef = useRef<Record<string, Tape>>({});
  const tradesRef = useRef<Record<string, Trade[]>>({});
  const prevKey = useRef<Record<string, Key>>({});

  // remember "notifications on" across reloads (per browser)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem("scanner-notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") setNotify(true);
      } catch { /* storage blocked: user can press the button again */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // 4h setups + 4h/1h trend context, refreshed every 60s
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`watchlist ${r.status}`)))),
        fetch("/api/live/levels", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`levels ${r.status}`)))),
      ]).then(([w, l]: [WatchData, LevelsData]) => { if (!cancelled) { setWatch(w); setLevels(l); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được tín hiệu 4h"); });
    };
    const first = setTimeout(load, 0), timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearTimeout(first); clearInterval(timer); };
  }, []);

  useEffect(() => {
    let stopped = false;
    const sockets: WebSocket[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    const flush = setInterval(() => { setTapes({ ...tapeRef.current }); setNow(Date.now()); }, 1000);
    const ping = setInterval(() => sockets.forEach((s) => s.readyState === WebSocket.OPEN && s.send("ping")), 25_000);

    const open = (url: string, args: { channel: string; instId: string }[], onData: (channel: string, coin: string, rows: unknown[]) => void, main: boolean) => {
      if (stopped) return;
      const ws = new WebSocket(url);
      sockets.push(ws);
      ws.onopen = () => { if (main) { setConnection("live"); setError(null); } ws.send(JSON.stringify({ op: "subscribe", args })); };
      ws.onmessage = (event) => {
        if (event.data === "pong") return;
        let msg: { arg?: { channel?: string; instId?: string }; data?: unknown[] };
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.arg?.channel && msg.arg.instId && msg.data?.length) onData(msg.arg.channel, msg.arg.instId.split("-")[0], msg.data);
      };
      ws.onerror = () => { if (main) setError("Mất kết nối WebSocket OKX"); };
      ws.onclose = () => {
        if (stopped) return;
        if (main) setConnection("retrying");
        timers.push(setTimeout(() => open(url, args, onData, main), 2000));
      };
    };

    open(PUBLIC_WS, COINS.flatMap((coin) => ["tickers", "books5", "trades"].map((channel) => ({ channel, instId: `${coin}-USDT-SWAP` }))), (channel, coin, rows) => {
      const current = tapeRef.current[coin] ?? emptyTape();
      if (channel === "tickers") {
        const row = rows[0] as Record<string, string>;
        tapeRef.current[coin] = { ...current, price: +row.last, bid: +row.bidPx, ask: +row.askPx, ts: +row.ts };
      } else if (channel === "books5") {
        const row = rows[0] as { bids?: string[][]; asks?: string[][] };
        const bids = (row.bids ?? []).reduce((s, x) => s + (+x[1] || 0), 0), asks = (row.asks ?? []).reduce((s, x) => s + (+x[1] || 0), 0);
        tapeRef.current[coin] = { ...current, bookBuy: bids + asks ? bids / (bids + asks) : 0.5 };
      } else if (channel === "trades") {
        const t = Date.now(), list = tradesRef.current[coin] ?? [];
        for (const raw of rows as Record<string, string>[]) list.push({ ts: +raw.ts, side: raw.side === "buy" ? "buy" : "sell", size: +raw.sz });
        const recent = list.filter((x) => x.ts >= t - 30_000);
        tradesRef.current[coin] = recent;
        const buy = recent.reduce((s, x) => s + (x.side === "buy" ? x.size : 0), 0), sell = recent.reduce((s, x) => s + (x.side === "sell" ? x.size : 0), 0);
        tapeRef.current[coin] = { ...current, tradeBuy: buy + sell ? buy / (buy + sell) : 0.5, tradeVolume: buy + sell };
      }
    }, true);


    return () => { stopped = true; clearInterval(flush); clearInterval(ping); timers.forEach(clearTimeout); sockets.forEach((s) => s.close()); };
  }, []);

  const plans = useMemo(() => {
    const out: Plan[] = [];
    for (const coin of COINS) {
      const tape = tapes[coin] ?? emptyTape();
      const w = watch?.coins.find((c) => c.coin === coin);
      for (const s of w?.setups ?? []) out.push(fourHourPlan(coin, s, tape, w!.lastBarTime, now));
    }
    // within the same verdict: tested 4h setups first, then fee-free coins on MEXC, then the closest plan
    const FREE = new Set(["XRP", "DOGE", "LINK", "ADA", "AVAX", "ARB", "PEPE", "INJ", "LTC", "DOT", "APT", "OP", "TIA", "NEAR"]);
    const score = (p: Plan) => {
      const l = p.levels, price = (tapes[p.coin] ?? emptyTape()).price;
      const dist = l && price ? Math.abs(price / l.entry - 1) : 1;
      return (p.kind === "4h" ? 2 : 0) + (FREE.has(p.coin) ? 1 : 0) - Math.min(dist * 20, 1.5);
    };
    return out.sort((a, b) => ORDER[a.key] - ORDER[b.key] || score(b) - score(a));
  }, [tapes, watch, now]);

  // notify on transitions into VÀO NGAY
  useEffect(() => {
    for (const p of plans) {
      if (p.key === "enter" && prevKey.current[p.id] && prevKey.current[p.id] !== "enter") {
        beep();
        if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`${p.coin} ${p.side > 0 ? "LONG" : "SHORT"}: VÀO NGAY`, { body: `${p.title}. Vào ${fmt(p.levels!.entry)}, SL ${fmt(p.levels!.stop)}, TP ${fmt(p.levels!.tp1)}` });
        }
      }
      prevKey.current[p.id] = p.key;
    }
  }, [plans, notify]);

  // only tradeable / watchable plans go in the table; rule-blocked ones are listed below it
  const shown = plans.filter((p) => p.text !== "KHÔNG ĐÁNH");
  const blocked = plans.filter((p) => p.text === "KHÔNG ĐÁNH");
  const idle = COINS.filter((c) => !plans.some((p) => p.coin === c));
  const star = (p: Plan) => watch?.coins.find((c) => c.coin === p.coin)?.daily === p.side;
  const trendOf = (coin: string) => levels?.rows.find((r) => r.coin === coin);

  return <section className="card live-scanner">
    <header className="card-head">
      <h2>Scanner live · 21 coin</h2>
      <div className="live-head"><label className="capital">Chịu mất $<input inputMode="decimal" value={lossUsd} onChange={(e) => setLossUsd(Number(e.target.value.replace(",", ".")) || 0)} /></label><label className="capital">Ký quỹ $<input inputMode="decimal" value={capital} onChange={(e) => { const v = Number(e.target.value.replace(",", ".")) || 0; setCapital(v); try { localStorage.setItem("scanner-margin", String(v)); } catch { /* ignore */ } }} /></label>
        <button className="primary" disabled={notify} onClick={async () => { if (typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted") { setNotify(true); beep(); try { localStorage.setItem("scanner-notify", "1"); } catch { /* ignore */ } } }}>
          {notify ? "Đã bật thông báo" : "Bật thông báo"}
        </button>
        <span className={`live-state ${connection}`}>{connection === "live" ? "● LIVE OKX" : connection === "connecting" ? "Đang kết nối…" : "Đang kết nối lại…"}</span>
      </div>
    </header>
    <p className="muted">
      Giá, sổ lệnh 5 mức và giao dịch 30 giây qua WebSocket (mỗi giây); tín hiệu 4h và xu hướng tính lại mỗi 60 giây{levels ? ` (lần cuối ${clock(levels.computedAt)})` : ""}.
      {watch?.btcDaily ? <b>Xu hướng ngày BTC: {watch.btcDaily > 0 ? "TĂNG (ưu tiên LONG)" : "GIẢM (chỉ hai đỉnh SHORT)"}. </b> : null}<b> VÀO NGAY</b> chỉ khi: nến 4h vừa đóng xác nhận <b>BOS LONG</b> hoặc <b>hai đỉnh/hai đáy cùng xu hướng ngày</b> (BTC và coin so với EMA50 ngày), và giá chưa chạy quá 0,5R. BOS SHORT và lệnh ngược xu hướng ngày ghi KHÔNG ĐÁNH. Đã bỏ kiểu vùng hồi 1h (lỗ -0,11R/lệnh trên 5.471 lệnh).
    </p>
    {error && <p className="verdict bad">{error}</p>}
    {shown.length === 0 && <p className="verdict neutral"><b>Chưa có lệnh nào vào được.</b> Lần kiểm tra tới: {next4h(now)}. Khi có tín hiệu, trang này kêu và bot gửi Telegram.</p>}
    {shown.length > 0 && <div className="table-wrap"><table className="stats-table live-table">
      <thead><tr><th>Coin</th><th>Kế hoạch</th><th>Kết luận</th><th>Giá live</th><th>Vùng / vào</th><th>Dừng lỗ</th><th>TP (★ 1R · thường 0,5R)</th><th>Đòn bẩy · lỗ/lời</th><th>Dòng lệnh</th></tr></thead>
      <tbody>{shown.map((p) => {
        const tape = tapes[p.coin] ?? emptyTape(), l = p.levels;
        const riskPct = l ? Math.abs(l.entry - l.stop) / l.entry : 0;
        const flowWith = p.side > 0 ? tape.tradeBuy : 1 - tape.tradeBuy;
        return <tr key={p.id} className={p.key === "enter" ? "live-enter" : ""}>
          <td><b>{p.coin}</b> <span className={`pill ${p.side > 0 ? "long" : "short"}`}>{p.side > 0 ? "LONG" : "SHORT"}</span>{(() => { const d = watch?.coins.find((c) => c.coin === p.coin)?.daily; return d === p.side ? <small className="pos">★ coin cùng xu hướng ngày (tốt nhất)</small> : d ? <small>coin ngược xu hướng ngày</small> : null; })()}</td>
          <td>{p.title}</td>
          <td><b className={`live-verdict ${p.key}`}>{p.text}</b><small>{p.reason}</small></td>
          <td>{tape.price ? fmt(tape.price) : "—"}<small>{clock(tape.ts)}</small></td>
          <td>{!l ? "—" : p.key === "enter" ? <b>{fmt(l.entry)}</b> : <>{p.side > 0 ? "nến 4h đóng >" : "nến 4h đóng <"} <b>{fmt(l.entry)}</b><small>{next4h(now)}</small></>}</td>
          <td className="neg">{l ? fmt(l.stop) : "—"}<small>{l ? pct(riskPct) : ""}</small></td>
          <td className="pos">{!l ? "—" : star(p) ? <><b>{fmt(l.entry + p.side * Math.abs(l.entry - l.stop))}</b><small>1R (lệnh ★)</small></> : <><b>{fmt(l.tp1)}</b><small>0,5R (lệnh thường)</small></>}</td>
          <td>{!l ? "—" : (() => {
            const lev = Math.min(20, lossUsd / (capital * riskPct)), notional = capital * lev, win = notional * (star(p) ? 1 : 0.5) * riskPct;
            return <><b>x{lev.toFixed(lev < 10 ? 1 : 0)}</b> · {capital}$ ký quỹ ({notional.toFixed(0)}$)<small>−{(notional * riskPct).toFixed(1)}$ ở SL / +{win.toFixed(1)}$ ở TP</small></>;
          })()}</td>
          <td>{tape.tradeVolume ? <span className={flowWith >= 0.55 ? "pos" : flowWith <= 0.45 ? "neg" : ""}>{(flowWith * 100).toFixed(0)}% cùng hướng</span> : "—"}<small>sổ lệnh mua {(tape.bookBuy * 100).toFixed(0)}%</small></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {blocked.length > 0 && <p className="muted">Bị luật loại (không đánh): {blocked.map((p) => `${p.coin} ${p.side > 0 ? "LONG" : "SHORT"} – ${p.reason}`).join("; ")}.</p>}
    {idle.length > 0 && <p className="muted">Chưa có cấu trúc 4h (xu hướng 4h / 1h): {idle.map((c) => {
      const t = trendOf(c);
      return t ? `${c} (4h ${t.trend4h > 0 ? "tăng" : t.trend4h < 0 ? "giảm" : "ngang"}, 1h ${t.trend1h > 0 ? "tăng" : t.trend1h < 0 ? "giảm" : "ngang"})` : c;
    }).join(", ")}.</p>}
    <p className="note">
      Kiểm chứng 2023–2026 (21 coin, phí 0%): chốt 0,5R thắng ~62%, ≈ +0,02R/lệnh. Trên 18 coin khác chưa từng dùng để chọn luật: ≈ 0 → lợi thế chưa chắc chắn, giữ rủi ro nhỏ. Lợi thế mỏng: luôn đặt dừng lỗ, đòn bẩy suy ra từ khoảng cách dừng lỗ. Cột &quot;Dòng lệnh&quot; (giao dịch 30 giây, sổ lệnh) chỉ để tham khảo, chưa kiểm chứng, sổ lệnh có thể bị rút. Scanner không đặt lệnh.
    </p>
  </section>;
}
