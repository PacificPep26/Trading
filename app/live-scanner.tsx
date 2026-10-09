"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";
const BUSINESS_WS = "wss://ws.okx.com:8443/ws/v5/business"; // candle channels live here
const MARGIN = 40, LEV = 15, NOTIONAL = MARGIN * LEV; // owner's usual 40$ margin at 15x
const RISK_4H = 3; // 4h stops are 4-8% away: size the position so the stop costs ~3$

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type Setup = { style: "bos" | "double_top_bottom"; state: "triggered" | "pending"; side: 1 | -1; entry: number; stop: number; tp15: number; tp2: number; distancePct: number };
type WatchData = { coins: { coin: string; setups: Setup[]; lastBarTime: number }[] };
type Zone = { coin: string; side: 1 | -1; zoneLow: number; zoneHigh: number; stop: number; target2: number; ema20: number; swing: number; stopPct: number };
type LevelsData = { rows: { coin: string; trend4h: number; trend1h: number; zone: Zone | null; last15m: (Bar & { closed: boolean }) | null }[]; computedAt: number };
type Tape = { price: number; bid: number; ask: number; bookBuy: number; tradeBuy: number; tradeVolume: number; ts: number };
type Trade = { ts: number; side: "buy" | "sell"; size: number };
type Key = "enter" | "wait" | "skip";
type Plan = {
  id: string; coin: string; kind: "zone" | "4h"; side: 1 | -1; title: string; key: Key; text: string; reason: string;
  levels?: { entry: number; stop: number; tp1: number; tp2: number; zone?: [number, number] };
};

const emptyTape = (): Tape => ({ price: 0, bid: 0, ask: 0, bookBuy: 0.5, tradeBuy: 0.5, tradeVolume: 0, ts: 0 });
const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const clock = (v: number) => (v ? new Date(v).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const ORDER: Record<Key, number> = { enter: 0, wait: 1, skip: 2 };

// identical to rejection() in service/backtest/patterns.py

function targets(side: 1 | -1, price: number, stop: number, structural: number) {
  const r = Math.abs(stop - price), tp1 = price + side * 1.5 * r;
  const tp2 = side * (structural - tp1) > 0 ? structural : price + side * 2.5 * r;
  return { entry: price, stop, tp1, tp2 };
}

function fourHourPlan(coin: string, s: Setup, tape: Tape, lastBarTime: number, now: number): Plan {
  const title = s.style === "bos" ? "Phá cấu trúc (BOS) 4h" : "Hai đỉnh / hai đáy 4h";
  const base = { id: `${coin}-4h-${s.style}`, coin, kind: "4h" as const, side: s.side, title, levels: { entry: s.entry, stop: s.stop, tp1: s.tp15, tp2: s.tp2 } };
  const p = tape.price;
  if (!p) return { ...base, key: "wait", text: "ĐANG LẤY GIÁ", reason: "Chờ WebSocket" };
  if (s.side > 0 ? p <= s.stop : p >= s.stop) return { ...base, key: "skip", text: "BỎ QUA", reason: "Giá đã vượt dừng lỗ" };
  if (s.state === "pending") {
    const crossed = s.side > 0 ? p > s.entry : p < s.entry;
    const dist = Math.abs(p / s.entry - 1);
    if (crossed) return { ...base, key: "wait", text: "CHỜ ĐÓNG 4H", reason: "Giá đã qua mức kích hoạt, cần nến 4h đóng cửa xác nhận" };
    return { ...base, key: dist <= 0.01 ? "wait" : "skip", text: dist <= 0.01 ? "CHỜ" : "BỎ QUA", reason: `Cách mức kích hoạt ${pct(dist)}` };
  }
  // triggered on the last closed 4h bar: valid until the next 4h bar closes
  const barClose = lastBarTime + 4 * 3_600_000;
  if (now - barClose > 4 * 3_600_000) return { ...base, key: "skip", text: "HẾT HẠN", reason: "Tín hiệu từ nến 4h trước, đã qua một nến" };
  const r0 = Math.abs(s.entry - s.stop);
  if (s.side * (p - s.entry) > 0.5 * r0) return { ...base, key: "skip", text: "ĐÃ CHẠY", reason: "Giá đã đi quá 0,5R từ điểm kích hoạt, không đuổi" };
  if (s.side * (p - s.tp15) >= 0) return { ...base, key: "skip", text: "ĐÃ TỚI TP", reason: "Đã chạm chốt lời 1,5R" };
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
  const [tapes, setTapes] = useState<Record<string, Tape>>({});
  const [bars, setBars] = useState<Record<string, Bar>>({});
  const [connection, setConnection] = useState<"connecting" | "live" | "retrying">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [now, setNow] = useState(0);
  const tapeRef = useRef<Record<string, Tape>>({});
  const barRef = useRef<Record<string, Bar>>({});
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

  // structural levels: 4h setups + 1h pullback zones, refreshed every 60s
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`watchlist ${r.status}`)))),
        fetch("/api/live/levels", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`levels ${r.status}`)))),
      ]).then(([w, l]: [WatchData, LevelsData]) => { if (!cancelled) { setWatch(w); setLevels(l); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được vùng giá"); });
    };
    const first = setTimeout(load, 0), timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearTimeout(first); clearInterval(timer); };
  }, []);

  useEffect(() => {
    let stopped = false;
    const sockets: WebSocket[] = [], timers: ReturnType<typeof setTimeout>[] = [];
    const flush = setInterval(() => { setTapes({ ...tapeRef.current }); setBars({ ...barRef.current }); setNow(Date.now()); }, 1000);
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

    // closed 15m candles in real time (confirm flag = "1")
    open(BUSINESS_WS, COINS.map((coin) => ({ channel: "candle15m", instId: `${coin}-USDT-SWAP` })), (_channel, coin, rows) => {
      for (const r of rows as string[][]) if (r[8] === "1") barRef.current[coin] = { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] };
    }, false);

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

  const idle = COINS.filter((c) => !plans.some((p) => p.coin === c));
  const trendOf = (coin: string) => levels?.rows.find((r) => r.coin === coin);

  return <section className="card live-scanner">
    <header className="card-head">
      <h2>Scanner live · 21 coin</h2>
      <div className="live-head">
        <button className="primary" disabled={notify} onClick={async () => { if (typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted") { setNotify(true); beep(); try { localStorage.setItem("scanner-notify", "1"); } catch { /* ignore */ } } }}>
          {notify ? "Đã bật thông báo" : "Bật thông báo"}
        </button>
        <span className={`live-state ${connection}`}>{connection === "live" ? "● LIVE OKX" : connection === "connecting" ? "Đang kết nối…" : "Đang kết nối lại…"}</span>
      </div>
    </header>
    <p className="muted">
      Giá, sổ lệnh 5 mức, giao dịch 30 giây và nến 15m qua WebSocket (cập nhật mỗi giây); vùng giá tính lại mỗi 60 giây{levels ? ` (lần cuối ${clock(levels.computedAt)})` : ""}.
      <b> VÀO NGAY</b> chỉ khi: nến 4h vừa đóng xác nhận BOS / hai đỉnh-hai đáy (2 kiểu duy nhất gần có lãi qua kiểm chứng) và giá chưa chạy quá 0,5R. Đã bỏ kiểu vùng hồi 1h (lỗ -0,11R/lệnh trên 5.471 lệnh).
    </p>
    {error && <p className="verdict bad">{error}</p>}
    <div className="table-wrap"><table className="stats-table live-table">
      <thead><tr><th>Coin</th><th>Kế hoạch</th><th>Kết luận</th><th>Giá live</th><th>Vùng / vào</th><th>Dừng lỗ</th><th>TP1 · TP2</th><th>Cỡ lệnh · lỗ/lời</th><th>Dòng lệnh</th></tr></thead>
      <tbody>{plans.map((p) => {
        const tape = tapes[p.coin] ?? emptyTape(), l = p.levels;
        const riskPct = l ? Math.abs(l.entry - l.stop) / l.entry : 0;
        const flowWith = p.side > 0 ? tape.tradeBuy : 1 - tape.tradeBuy;
        return <tr key={p.id} className={p.key === "enter" ? "live-enter" : ""}>
          <td><b>{p.coin}</b> <span className={`pill ${p.side > 0 ? "long" : "short"}`}>{p.side > 0 ? "LONG" : "SHORT"}</span></td>
          <td>{p.title}</td>
          <td><b className={`live-verdict ${p.key}`}>{p.text}</b><small>{p.reason}</small></td>
          <td>{tape.price ? fmt(tape.price) : "—"}<small>{clock(tape.ts)}</small></td>
          <td>{l?.zone ? `${fmt(l.zone[0])} – ${fmt(l.zone[1])}` : l ? fmt(l.entry) : "—"}{l?.zone && p.key === "enter" && <small>vào {fmt(l.entry)}</small>}</td>
          <td className="neg">{l ? fmt(l.stop) : "—"}<small>{l ? pct(riskPct) : ""}</small></td>
          <td className="pos">{l ? `${fmt(l.tp1)} · ${fmt(l.tp2)}` : "—"}</td>
          <td>{!l ? "—" : p.kind === "zone" ? <>15x ({NOTIONAL}$)<small>−{(NOTIONAL * (riskPct + 0.001)).toFixed(1)}$ / +{(NOTIONAL * (1.5 * riskPct - 0.001)).toFixed(1)}$</small></> : (() => {
            const notional = RISK_4H / (riskPct + 0.001), lev = notional / MARGIN;
            return <>{lev < 1 ? `${notional.toFixed(0)}$ (<1x)` : `≤ ${lev.toFixed(1)}x`}<small className="neg">KHÔNG dùng 15x: thanh lý trước dừng lỗ</small><small>−{RISK_4H}$ / +{(notional * (1.5 * riskPct - 0.001)).toFixed(1)}$</small></>;
          })()}</td>
          <td>{tape.tradeVolume ? <span className={flowWith >= 0.55 ? "pos" : flowWith <= 0.45 ? "neg" : ""}>{(flowWith * 100).toFixed(0)}% cùng hướng</span> : "—"}<small>sổ lệnh mua {(tape.bookBuy * 100).toFixed(0)}%</small></td>
        </tr>;
      })}</tbody>
    </table></div>
    {idle.length > 0 && <p className="muted">Không có kế hoạch (4h và 1h không cùng xu hướng, không có setup 4h): {idle.map((c) => {
      const t = trendOf(c);
      return t ? `${c} (4h ${t.trend4h > 0 ? "tăng" : t.trend4h < 0 ? "giảm" : "ngang"}, 1h ${t.trend1h > 0 ? "tăng" : t.trend1h < 0 ? "giảm" : "ngang"})` : c;
    }).join(", ")}.</p>}
    <p className="note">
      Kiểm chứng 2023–2026 (21 coin): BOS 4h ≈ +0,04R/lệnh, thắng ~47% với phí MEXC; hai đỉnh/hai đáy 4h ≈ +0,02R. Lợi thế mỏng: luôn đặt dừng lỗ, đòn bẩy suy ra từ khoảng cách dừng lỗ. Cột &quot;Dòng lệnh&quot; (giao dịch 30 giây, sổ lệnh) chỉ để tham khảo, chưa kiểm chứng, sổ lệnh có thể bị rút. Scanner không đặt lệnh.
    </p>
  </section>;
}
