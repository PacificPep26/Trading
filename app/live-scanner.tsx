"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateSizing, calculatePartialPnL, isStarSetup } from "@/lib/trading-policy";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";

type Setup = { style: "bos" | "double_top_bottom"; state: "triggered" | "pending"; side: 1 | -1; entry: number; stop: number; tp15: number; tp2: number; distancePct: number; blocked?: string | null; level?: number };
type WatchData = { coins: { coin: string; setups: Setup[]; lastBarTime: number; daily?: number }[]; btcDaily?: number };
type LevelsData = { rows: { coin: string; trend4h: number; trend1h: number }[]; computedAt: number };
type Tape = { price: number; bid: number; ask: number; bookBuy: number; tradeBuy: number; tradeVolume: number; ts: number };
type Trade = { ts: number; side: "buy" | "sell"; size: number };
type Key = "enter" | "wait" | "skip";
type Plan = {
  id: string; coin: string; kind: "4h"; side: 1 | -1; title: string; key: Key; text: string; reason: string;
  levels?: { entry: number; stop: number; tp1: number; tp2: number };
  exitLevel?: number;
};

const emptyTape = (): Tape => ({ price: 0, bid: 0, ask: 0, bookBuy: 0.5, tradeBuy: 0.5, tradeVolume: 0, ts: 0 });
const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const clock = (v: number) => (v ? new Date(v).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const ORDER: Record<Key, number> = { enter: 0, wait: 1, skip: 2 };

// identical to rejection() in service/backtest/patterns.py

function targets(side: 1 | -1, price: number, stop: number, structural: number) {
  // agreed exit: 0.5R and 1.0R (target $5 at 1R)
  const r = Math.abs(stop - price);
  void structural;
  return { entry: price, stop, tp1: price + side * 0.5 * r, tp2: price + side * 1.0 * r };
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
  const base = { id: `${coin}-4h-${s.style}`, coin, kind: "4h" as const, side: s.side, title, exitLevel: s.level, levels: { entry: s.entry, stop: s.stop, tp1: s.entry + s.side * 0.5 * Math.abs(s.entry - s.stop), tp2: s.entry + s.side * 1.0 * Math.abs(s.entry - s.stop) } };
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
  if (s.side * (p - (s.entry + s.side * 1.0 * Math.abs(s.entry - s.stop))) >= 0) return { ...base, key: "skip", text: "ĐÃ TỚI TP", reason: "Đã chạm chốt lời 1R" };
  return { ...base, key: "enter", text: "VÀO NGAY", reason: "Nến 4h vừa đóng xác nhận setup", levels: targets(s.side, s.entry, s.stop, s.tp2) };
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
  const [capital, setCapital] = useState(36); // legacy margin ($)
  const [equity, setEquity] = useState(40); // account size ($)
  // "disciplined" = target $5 risk/reward at 1R, capped by available buying power
  const [mode, setMode] = useState<"disciplined" | "bold" | "safe">("disciplined");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const m = localStorage.getItem("scanner-mode-v2");
        if (m === "safe" || m === "bold" || m === "disciplined") setMode(m);
        const vm = localStorage.getItem("scanner-view-mode");
        if (vm === "cards" || vm === "table") {
          setViewMode(vm);
        } else if (typeof window !== "undefined" && window.innerWidth >= 860) {
          setViewMode("table");
        }
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const e = Number(localStorage.getItem("scanner-equity"));
        if (e > 0) setEquity(e);
        const v = Number(localStorage.getItem("scanner-margin"));
        if (v > 0) setCapital(v);
      } catch { /* ignore */ }
    }, 0);
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
      for (const s of w?.setups ?? []) {
        const planSetup = mode === "bold"
          ? { ...s, blocked: null }
          : mode === "safe"
          ? (w?.daily === s.side || s.blocked ? s : { ...s, blocked: "Lệnh thường (coin ngược xu hướng ngày): chỉ đánh lệnh ★" })
          : s;
        out.push(fourHourPlan(coin, planSetup, tape, w!.lastBarTime, now));
      }
    }
    // within the same verdict: tested 4h setups first, then fee-free coins on MEXC, then the closest plan
    const FREE = new Set(["XRP", "DOGE", "LINK", "ADA", "AVAX", "ARB", "PEPE", "INJ", "LTC", "DOT", "APT", "OP", "TIA", "NEAR"]);
    const score = (p: Plan) => {
      const l = p.levels, price = (tapes[p.coin] ?? emptyTape()).price;
      const dist = l && price ? Math.abs(price / l.entry - 1) : 1;
      return (p.kind === "4h" ? 2 : 0) + (FREE.has(p.coin) ? 1 : 0) - Math.min(dist * 20, 1.5);
    };
    return out.sort((a, b) => ORDER[a.key] - ORDER[b.key] || score(b) - score(a));
  }, [tapes, watch, now, mode]);

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
  const trendOf = (coin: string) => levels?.rows.find((r) => r.coin === coin);

  return (
    <section className="card live-scanner-card">
      <header className="card-head scanner-header">
        <div className="scanner-title-bar">
          <div>
            <h2>Scanner live · 21 coin</h2>
            <p className="scanner-sub-status">
              Tín hiệu 4h &amp; 1h · WebSocket OKX{levels ? ` (cập nhật ${clock(levels.computedAt)})` : ""}
            </p>
          </div>
          <div className="scanner-live-badge-wrap">
            <span className={`live-state-pill ${connection}`}>
              <span className="live-dot" />
              {connection === "live" ? "LIVE OKX" : connection === "connecting" ? "ĐANG KẾT NỐI…" : "KẾT NỐI LẠI…"}
            </span>
          </div>
        </div>

        <div className="scanner-controls-panel">
          <div className="ctrl-group ctrl-mode">
            <label className="ctrl-label">Kiểu giao dịch</label>
            <div className="select-wrap">
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as "disciplined" | "bold" | "safe";
                  setMode(m);
                  try { localStorage.setItem("scanner-mode-v2", m); } catch { /* ignore */ }
                }}
              >
                <option value="disciplined">Toàn bộ vốn isolated x10 · SL cấu trúc (Khuyên dùng)</option>
                <option value="safe">An toàn (★ xu hướng ngày, 10% vốn)</option>
                <option value="bold">Kiểu cũ (x10, dồn lệnh, TP 0,75R)</option>
              </select>
            </div>
          </div>

          <div className="ctrl-row-params">
            <div className="ctrl-group">
              <label className="ctrl-label">Vốn tài khoản ($)</label>
              <div className="input-group">
                <span className="input-affix">$</span>
                <input
                  inputMode="decimal"
                  value={equity}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(",", ".")) || 0;
                    setEquity(v);
                    try { localStorage.setItem("scanner-equity", String(v)); } catch { /* ignore */ }
                  }}
                />
              </div>
            </div>

            {mode !== "disciplined" ? (
              <div className="ctrl-group">
                <label className="ctrl-label">Ký quỹ ($)</label>
                <div className="input-group">
                  <span className="input-affix">$</span>
                  <input
                    inputMode="decimal"
                    value={capital}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(",", ".")) || 0;
                      setCapital(v);
                      try { localStorage.setItem("scanner-margin", String(v)); } catch { /* ignore */ }
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="ctrl-group">
                <label className="ctrl-label">Đòn bẩy MEXC</label>
                <div className="fixed-badge">x10 Isolated</div>
              </div>
            )}
          </div>

          <div className="ctrl-row-actions">
            <button
              className={`btn-notify ${notify ? "is-active" : ""}`}
              disabled={notify}
              onClick={async () => {
                if (typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted") {
                  setNotify(true);
                  beep();
                  try { localStorage.setItem("scanner-notify", "1"); } catch { /* ignore */ }
                }
              }}
            >
              {notify ? "✓ Đã bật chuông báo" : "🔔 Bật chuông báo khi có kèo"}
            </button>

            {shown.length > 0 && (
              <div className="view-mode-toggle">
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === "cards" ? "active" : ""}`}
                  onClick={() => {
                    setViewMode("cards");
                    try { localStorage.setItem("scanner-view-mode", "cards"); } catch { /* ignore */ }
                  }}
                >
                  📱 Thẻ
                </button>
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`}
                  onClick={() => {
                    setViewMode("table");
                    try { localStorage.setItem("scanner-view-mode", "table"); } catch { /* ignore */ }
                  }}
                >
                  📋 Bảng
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && <p className="verdict bad">{error}</p>}

      {/* Radar / Empty State Card */}
      {shown.length === 0 && (
        <div className="scanner-empty-card">
          <div className="radar-head">
            <div className="radar-pulse">
              <span className="radar-ping" />
              <span className="radar-core" />
            </div>
            <div>
              <h3 className="radar-title">Chưa có lệnh nào thỏa mãn bộ lọc</h3>
              <p className="radar-sub">Đang quét 21 cặp coin liên tục qua WebSocket OKX</p>
            </div>
          </div>

          <div className="radar-grid">
            <div className="radar-item">
              <span className="radar-lbl">⏰ Nến 4H kế đóng lúc</span>
              <b className="radar-val highlight">{next4h(now)}</b>
              <span className="radar-hint">Chỉ vào lệnh khi nến 4h đã đóng xác nhận</span>
            </div>
            <div className="radar-item">
              <span className="radar-lbl">📈 Xu hướng ngày BTC</span>
              <b className={`radar-val ${watch?.btcDaily && watch.btcDaily > 0 ? "pos" : "neg"}`}>
                {watch?.btcDaily ? (watch.btcDaily > 0 ? "TĂNG (Ưu tiên LONG)" : "GIẢM (Chỉ hai đỉnh SHORT)") : "Đang kiểm tra…"}
              </b>
              <span className="radar-hint">Lọc nhiễu theo EMA50 ngày</span>
            </div>
          </div>

          <div className="radar-footer">
            <span>🔔 <b>Tự động báo kèo:</b> Khi có tín hiệu xác nhận (BOS 4H hoặc Hai đỉnh/đáy), trang web sẽ rung chuông và bot sẽ bắn thông báo vào Telegram của bạn ngay lập tức.</span>
          </div>
        </div>
      )}

      {/* Signals Display: Cards View */}
      {shown.length > 0 && viewMode === "cards" && (
        <div className="signal-cards-wrap">
          {shown.map((p) => {
            const tape = tapes[p.coin] ?? emptyTape(), l = p.levels;
            const riskPct = l ? Math.abs(l.entry - l.stop) / l.entry : 0;
            const flowWith = p.side > 0 ? tape.tradeBuy : 1 - tape.tradeBuy;
            const ownDaily = watch?.coins.find((c) => c.coin === p.coin)?.daily ?? 0;
            const btcDaily = watch?.btcDaily ?? 0;
            const isStar = isStarSetup(p.side, ownDaily, btcDaily);
            const sizing = mode === "disciplined" ? calculateSizing(equity, riskPct) : null;
            const pnl = sizing ? calculatePartialPnL(sizing.actualRiskUsd) : null;

            return (
              <article key={p.id} className={`signal-card ${p.key === "enter" ? "is-enter" : ""}`}>
                <div className="sig-card-head">
                  <div className="sig-coin-group">
                    <span className="sig-coin-sym">{p.coin}</span>
                    <span className={`pill ${p.side > 0 ? "long" : "short"}`}>
                      {p.side > 0 ? "LONG ↗" : "SHORT ↘"}
                    </span>
                    {isStar && <span className="star-tag">★ Thuận xu hướng ngày</span>}
                  </div>
                  <span className={`sig-verdict-badge ${p.key}`}>
                    {p.text}
                  </span>
                </div>

                <div className="sig-desc-row">
                  <span className="sig-pattern-title">{p.title}</span>
                  <span className="sig-pattern-reason">{p.reason}</span>
                </div>

                <div className="sig-prices-grid">
                  <div className="sig-price-box">
                    <span className="box-lbl">Giá Live</span>
                    <b className="box-val">{tape.price ? fmt(tape.price) : "—"}</b>
                    <span className="box-sub">{clock(tape.ts)}</span>
                  </div>
                  <div className="sig-price-box">
                    <span className="box-lbl">Điểm Vào</span>
                    <b className="box-val pos">{!l ? "—" : p.key === "enter" ? fmt(l.entry) : fmt(l.entry)}</b>
                    <span className="box-sub">{p.key === "enter" ? "Đã xác nhận" : `Chờ ${next4h(now)}`}</span>
                  </div>
                  <div className="sig-price-box">
                    <span className="box-lbl">Dừng Lỗ (SL)</span>
                    <b className="box-val neg">{l ? fmt(l.stop) : "—"}</b>
                    <span className="box-sub neg">{l ? `−${pct(riskPct)}` : ""}</span>
                  </div>
                </div>

                {l && mode === "disciplined" && sizing && pnl && (
                  <>
                    <div className="sig-tp-panel">
                      <div className="tp-line">
                        <span className="tp-badge">TP 1 (0,5R)</span>
                        <b className="tp-val">{fmt(l.entry + p.side * 0.5 * Math.abs(l.entry - l.stop))}</b>
                        <span className="tp-sub pos">Chốt 50%: +{pnl.winTp1.toFixed(2)}$ · Dời SL hòa</span>
                      </div>
                      <div className="tp-line">
                        <span className="tp-badge">TP 2 (1,0R)</span>
                        <b className="tp-val">{fmt(l.entry + p.side * 1.0 * Math.abs(l.entry - l.stop))}</b>
                        <span className="tp-sub pos">Đạt cả 2 TP: Tổng +{pnl.totalWin.toFixed(2)}$</span>
                      </div>
                    </div>

                    <div className="sig-mexc-card">
                      <div className="mexc-card-title">
                        <span>⚡ Thông số vào app MEXC</span>
                        <span className="mexc-sub">Phí 0% Maker</span>
                      </div>
                      <div className="mexc-grid">
                        <div className="mexc-cell">
                          <span>Đòn bẩy</span>
                          <b className="highlight">x{sizing.leverage}</b>
                        </div>
                        <div className="mexc-cell">
                          <span>Ký quỹ</span>
                          <b>{sizing.margin}$</b>
                        </div>
                        <div className="mexc-cell">
                          <span>Vị thế</span>
                          <b>{sizing.notional}$</b>
                        </div>
                        <div className="mexc-cell">
                          <span>Lỗ ở SL</span>
                          <b className="neg">−{sizing.actualRiskUsd}$</b>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {l && mode !== "disciplined" && (
                  <div className="sig-tp-panel">
                    {mode === "bold" ? (
                      <div className="tp-line">
                        <span className="tp-badge">TP (0,75R)</span>
                        <b className="tp-val">{fmt(l.entry + p.side * 0.75 * Math.abs(l.entry - l.stop))}</b>
                      </div>
                    ) : (
                      <>
                        <div className="tp-line">
                          <span className="tp-badge">TP 1 (0,5R)</span>
                          <b className="tp-val">{fmt(l.entry + p.side * 0.5 * Math.abs(l.entry - l.stop))}</b>
                        </div>
                        <div className="tp-line">
                          <span className="tp-badge">TP 2 (1,0R)</span>
                          <b className="tp-val">{fmt(l.entry + p.side * Math.abs(l.entry - l.stop))}</b>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="sig-tape-bar">
                  <span>Dòng lệnh 30s: <b className={flowWith >= 0.55 ? "pos" : flowWith <= 0.45 ? "neg" : ""}>{(flowWith * 100).toFixed(0)}% cùng hướng</b></span>
                  <span>Sổ lệnh mua: <b>{(tape.bookBuy * 100).toFixed(0)}%</b></span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Signals Display: Table View */}
      {shown.length > 0 && viewMode === "table" && (
        <div className="table-wrap">
          <table className="stats-table live-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Kế hoạch</th>
                <th>Kết luận</th>
                <th>Giá live</th>
                <th>Vùng / vào</th>
                <th>Dừng lỗ</th>
                <th>TP</th>
                <th>Đòn bẩy · Cỡ lệnh · Lỗ/lời</th>
                <th>Dòng lệnh</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const tape = tapes[p.coin] ?? emptyTape(), l = p.levels;
                const riskPct = l ? Math.abs(l.entry - l.stop) / l.entry : 0;
                const flowWith = p.side > 0 ? tape.tradeBuy : 1 - tape.tradeBuy;
                return (
                  <tr key={p.id} className={p.key === "enter" ? "live-enter" : ""}>
                    <td>
                      <b>{p.coin}</b> <span className={`pill ${p.side > 0 ? "long" : "short"}`}>{p.side > 0 ? "LONG" : "SHORT"}</span>
                      {(() => {
                        const d = watch?.coins.find((c) => c.coin === p.coin)?.daily;
                        return d === p.side ? <small className="pos">★ coin cùng xu hướng ngày (tốt nhất)</small> : d ? <small>coin ngược xu hướng ngày</small> : null;
                      })()}
                    </td>
                    <td>{p.title}</td>
                    <td><b className={`live-verdict ${p.key}`}>{p.text}</b><small>{p.reason}</small></td>
                    <td>{tape.price ? fmt(tape.price) : "—"}<small>{clock(tape.ts)}</small></td>
                    <td>{!l ? "—" : p.key === "enter" ? <b>{fmt(l.entry)}</b> : <>{p.side > 0 ? "nến 4h đóng >" : "nến 4h đóng <"} <b>{fmt(l.entry)}</b><small>{next4h(now)}</small></>}</td>
                    <td className="neg">{l ? fmt(l.stop) : "—"}<small>{l ? pct(riskPct) : ""}</small>{p.exitLevel ? <small>thoát sớm: nến 4h đóng {p.side > 0 ? "<" : ">"} {fmt(p.exitLevel)}</small> : null}</td>
                    <td className="pos">
                      {!l ? "—" : mode === "disciplined" ? (() => {
                        const sizing = calculateSizing(equity, riskPct);
                        const pnl = calculatePartialPnL(sizing.actualRiskUsd);
                        return <>
                          <b>{fmt(l.entry + p.side * 0.5 * Math.abs(l.entry - l.stop))}</b>
                          <small>TP gần · nếu chốt 50%: +{pnl.winTp1.toFixed(2)}$ · dời SL hòa</small>
                          <b>{fmt(l.entry + p.side * 1.0 * Math.abs(l.entry - l.stop))}</b>
                          <small>TP chính · chốt toàn bộ: +{sizing.actualRiskUsd.toFixed(2)}$; nếu đã chốt nửa: tổng +{pnl.totalWin.toFixed(2)}$</small>
                        </>;
                      })() : mode === "bold" ? <><b>{fmt(l.entry + p.side * 0.75 * Math.abs(l.entry - l.stop))}</b><small>0,75R</small></> : <><b>{fmt(l.entry + p.side * 0.5 * Math.abs(l.entry - l.stop))}</b><small>nửa ở 0,5R → SL về giá vào</small><b>{fmt(l.entry + p.side * Math.abs(l.entry - l.stop))}</b><small>nửa ở 1R</small></>}
                    </td>
                    <td>
                      {!l ? "—" : (() => {
                        if (mode === "disciplined") {
                          const sizing = calculateSizing(equity, riskPct);
                          const pnl = calculatePartialPnL(sizing.actualRiskUsd);
                          return <>
                            <b>x{sizing.leverage}</b> · {sizing.margin}$ ký quỹ ({sizing.notional}$ vị thế)
                            <small className="neg">−{sizing.actualRiskUsd}$ ở SL{sizing.isCapped ? " (đã giới hạn theo vốn)" : ""}</small>
                            <small className="pos">TP gần +{pnl.winTp1.toFixed(2)}$ nếu chốt nửa · đạt TP chính tổng +{pnl.totalWin.toFixed(2)}$</small>
                          </>;
                        }
                        const lev = mode === "bold" ? Math.min(10, Math.floor(0.85 / riskPct)) : Math.min(20, (equity * 0.1) / (capital * riskPct));
                        const notional = capital * lev, win = notional * riskPct * 0.75;
                        return <><b>x{lev.toFixed(lev < 10 ? 1 : 0)}</b> · {capital}$ ký quỹ ({notional.toFixed(0)}$)<small>−{(notional * riskPct).toFixed(1)}$ ở SL / +{win.toFixed(1)}$ ở TP</small></>;
                      })()}
                    </td>
                    <td>{tape.tradeVolume ? <span className={flowWith >= 0.55 ? "pos" : flowWith <= 0.45 ? "neg" : ""}>{(flowWith * 100).toFixed(0)}% cùng hướng</span> : "—"}<small>sổ lệnh mua {(tape.bookBuy * 100).toFixed(0)}%</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Blocked and Disqualified Setups */}
      {blocked.length > 0 && (
        <details className="blocked-coins-details">
          <summary className="blocked-coins-summary">
            <span>🚫 Setup bị bộ lọc loại ({blocked.length})</span>
          </summary>
          <ul className="blocked-list">
            {blocked.map((p) => (
              <li key={p.id}>
                <b>{p.coin}</b> <span className={`pill ${p.side > 0 ? "long" : "short"}`}>{p.side > 0 ? "LONG" : "SHORT"}</span>: {p.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Market 21 Coins Overview */}
      {idle.length > 0 && (
        <details className="market-coins-details">
          <summary className="market-coins-summary">
            <div className="summary-left">
              <span>📊 Xu hướng 21 coin trên thị trường</span>
            </div>
            <span className="market-count">{idle.length} coin</span>
          </summary>
          <div className="market-coins-grid">
            {idle.map((c) => {
              const t = trendOf(c);
              return (
                <div key={c} className="coin-trend-chip">
                  <span className="coin-chip-sym">{c}</span>
                  {t ? (
                    <div className="coin-chip-tags">
                      <span className={`tf-tag ${t.trend4h > 0 ? "pos" : t.trend4h < 0 ? "neg" : "flat"}`}>
                        4H {t.trend4h > 0 ? "↗" : t.trend4h < 0 ? "↘" : "—"}
                      </span>
                      <span className={`tf-tag ${t.trend1h > 0 ? "pos" : t.trend1h < 0 ? "neg" : "flat"}`}>
                        1H {t.trend1h > 0 ? "↗" : t.trend1h < 0 ? "↘" : "—"}
                      </span>
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      <p className="note">
        Cấu hình hiện tại: dùng toàn bộ vốn làm isolated margin x10 (40$ → vị thế 400$). SL theo cấu trúc trên đỉnh/dưới đáy, nên số tiền lỗ thay đổi theo khoảng cách SL; SL 4% ≈ −16$, SL 8% ≈ −32$. Không có giới hạn lỗ cố định 5$.
      </p>
    </section>
  );
}
