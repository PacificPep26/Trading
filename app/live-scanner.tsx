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
  const [equity, setEquity] = useState(40);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [tapes, setTapes] = useState<Record<string, Tape>>({});
  const [connection, setConnection] = useState<"connecting" | "live" | "retrying">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [now, setNow] = useState(0);
  const tapeRef = useRef<Record<string, Tape>>({});
  const tradesRef = useRef<Record<string, Trade[]>>({});
  const prevKey = useRef<Record<string, Key>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const vm = localStorage.getItem("scanner-view-mode");
        if (vm === "cards" || vm === "table") {
          setViewMode(vm);
        } else if (typeof window !== "undefined" && window.innerWidth >= 860) {
          setViewMode("table");
        }
        const e = Number(localStorage.getItem("scanner-equity"));
        if (e > 0) setEquity(e);
        if (localStorage.getItem("scanner-notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") {
          setNotify(true);
        }
      } catch { /* ignore */ }
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
        out.push(fourHourPlan(coin, s, tape, w!.lastBarTime, now));
      }
    }
    const FREE = new Set(["XRP", "DOGE", "LINK", "ADA", "AVAX", "ARB", "PEPE", "INJ", "LTC", "DOT", "APT", "OP", "TIA", "NEAR"]);
    const score = (p: Plan) => {
      const l = p.levels, price = (tapes[p.coin] ?? emptyTape()).price;
      const dist = l && price ? Math.abs(price / l.entry - 1) : 1;
      return (p.kind === "4h" ? 2 : 0) + (FREE.has(p.coin) ? 1 : 0) - Math.min(dist * 20, 1.5);
    };
    return out.sort((a, b) => ORDER[a.key] - ORDER[b.key] || score(b) - score(a));
  }, [tapes, watch, now]);

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

  const shown = plans.filter((p) => p.text !== "KHÔNG ĐÁNH");

  return (
    <section className="clean-scanner">
      {/* Top Header */}
      <header className="scanner-top">
        <div className="brand-group">
          <span className="brand-icon">✦</span>
          <div>
            <h1 className="scanner-title">Northstar Scanner</h1>
            <p className="scanner-subtitle">Quét 21 coin live · Nến 4H</p>
          </div>
        </div>
        <div className="status-group">
          <span className={`status-pill ${connection}`}>
            <span className="dot" />
            {connection === "live" ? "LIVE OKX" : "KẾT NỐI…"}
          </span>
        </div>
      </header>

      {/* Ultra Clean Toolbar */}
      <div className="clean-toolbar">
        <div className="tool-item">
          <label className="tool-lbl">Vốn ($)</label>
          <div className="clean-input-box">
            <span className="prefix">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={equity}
              onChange={(e) => {
                const v = Number(e.target.value.replace(",", ".")) || 0;
                setEquity(v);
                try { localStorage.setItem("scanner-equity", String(v)); } catch {}
              }}
            />
          </div>
        </div>

        <div className="tool-item">
          <label className="tool-lbl">Đòn bẩy MEXC</label>
          <div className="clean-badge">x10 Isolated</div>
        </div>

        <div className="tool-item tool-btn-wrap">
          <button
            type="button"
            className={`clean-btn-notify ${notify ? "active" : ""}`}
            onClick={async () => {
              if (notify) return;
              if (typeof Notification !== "undefined" && (await Notification.requestPermission()) === "granted") {
                setNotify(true);
                beep();
                try { localStorage.setItem("scanner-notify", "1"); } catch {}
              }
            }}
          >
            {notify ? "✓ Chuông đang bật" : "🔔 Bật chuông báo"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Main Signal Area */}
      {shown.length === 0 ? (
        <div className="clean-empty-box">
          <div className="empty-radar">
            <span className="radar-ping" />
            <span className="radar-core" />
          </div>
          <div className="empty-text">
            <h3>Đang quét 21 coin... Chưa có kèo</h3>
            <p className="next-time">
              ⏰ Nến 4H kế đóng lúc: <b>{next4h(now)}</b>
            </p>
            <p className="note-telegram">
              ⚡ Khi nến 4H đóng xác nhận kèo (BOS / Hai đỉnh), trang sẽ reo chuông và gửi Telegram ngay.
            </p>
          </div>
        </div>
      ) : (
        <div className="signal-cards-container">
          {shown.map((p) => {
            const tape = tapes[p.coin] ?? emptyTape(), l = p.levels;
            const riskPct = l ? Math.abs(l.entry - l.stop) / l.entry : 0;
            const ownDaily = watch?.coins.find((c) => c.coin === p.coin)?.daily ?? 0;
            const btcDaily = watch?.btcDaily ?? 0;
            const isStar = isStarSetup(p.side, ownDaily, btcDaily);
            const sizing = calculateSizing(equity, riskPct);
            const pnl = calculatePartialPnL(sizing.actualRiskUsd);

            return (
              <article key={p.id} className={`clean-card ${p.key === "enter" ? "is-enter" : ""}`}>
                <div className="card-top-row">
                  <div className="coin-title-wrap">
                    <span className="coin-name">{p.coin}</span>
                    <span className={`side-badge ${p.side > 0 ? "long" : "short"}`}>
                      {p.side > 0 ? "LONG ↗" : "SHORT ↘"}
                    </span>
                    {isStar && <span className="star-tag">★ Thuận ngày</span>}
                  </div>
                  <span className={`verdict-pill ${p.key}`}>{p.text}</span>
                </div>

                <div className="setup-desc">
                  <b>{p.title}:</b> {p.reason}
                </div>

                {/* Price levels */}
                <div className="levels-row">
                  <div className="lvl-box">
                    <span className="lvl-lbl">Giá live</span>
                    <b className="lvl-val">{tape.price ? fmt(tape.price) : "—"}</b>
                  </div>
                  <div className="lvl-box">
                    <span className="lvl-lbl">Vào lệnh</span>
                    <b className="lvl-val pos">{l ? fmt(l.entry) : "—"}</b>
                  </div>
                  <div className="lvl-box">
                    <span className="lvl-lbl">Dừng lỗ (SL)</span>
                    <b className="lvl-val neg">{l ? fmt(l.stop) : "—"}</b>
                    <small className="neg">({pct(riskPct)})</small>
                  </div>
                </div>

                {/* Targets */}
                {l && (
                  <div className="tp-container">
                    <div className="tp-line">
                      <span className="tp-tag">TP 1 (0,5R)</span>
                      <b>{fmt(l.entry + p.side * 0.5 * Math.abs(l.entry - l.stop))}</b>
                      <span className="pos">+{(pnl.winTp1).toFixed(2)}$ (chốt 50%, dời SL hòa)</span>
                    </div>
                    <div className="tp-line">
                      <span className="tp-tag">TP 2 (1,0R)</span>
                      <b>{fmt(l.entry + p.side * 1.0 * Math.abs(l.entry - l.stop))}</b>
                      <span className="pos">Tổng +{(pnl.totalWin).toFixed(2)}$</span>
                    </div>
                  </div>
                )}

                {/* MEXC execution info */}
                {l && (
                  <div className="mexc-info-box">
                    <div className="mexc-row">
                      <span>Đòn bẩy: <b>x{sizing.leverage}</b></span>
                      <span>Ký quỹ: <b>{sizing.margin}$</b></span>
                      <span>Vị thế: <b>{sizing.notional}$</b></span>
                      <span className="neg">Lỗ SL: <b>−{sizing.actualRiskUsd}$</b></span>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <footer className="clean-footer">
        Kỷ luật MEXC · Isolated x10 · Dừng lỗ cấu trúc 4H · Đóng 2 lệnh thua liên tiếp nghỉ hết ngày
      </footer>
    </section>
  );
}
