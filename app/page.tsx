"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import playbook from "@/lib/playbook.json";
import { context, detect, SETUP_INFO } from "@/lib/setups";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean };
type Market = {
  inst: string;
  bar: string;
  ticker: { last: number; open24h: number; high24h: number; low24h: number; vol24h: number; ts: number };
  funding: { rate: number; nextTime: number };
  openInterest: { coins: number; usd: number };
  candles: Candle[];
  volumeRatio: number | null;
  btc1hMove: number | null;
  btcLast: number | null;
  alerts: { level: "warn" | "info"; text: string }[];
  fetchedAt: number;
};

const INSTRUMENTS = [
  { id: "SOL-USDT-SWAP", label: "SOL" },
  { id: "BTC-USDT-SWAP", label: "BTC" },
  { id: "ETH-USDT-SWAP", label: "ETH" },
  { id: "HYPE-USDT-SWAP", label: "HYPE" },
];
const BARS = [
  { id: "15m", label: "15m" },
  { id: "1H", label: "1h" },
  { id: "4H", label: "4h" },
];
const SOL_BTC_BETA = 1.37; // measured on 2023–2026 data: BTC +1% -> SOL ~+1.37%
const TAKER_FEE = 0.0005; // OKX perp taker, per side

const fmt = (v: number, d = 2) => v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

function CandleChart({ candles }: { candles: Candle[] }) {
  const W = 900, H = 320, VH = 60, PAD = 8;
  const { bars, ticks, min, max } = useMemo(() => {
    const min = Math.min(...candles.map((c) => c.l));
    const max = Math.max(...candles.map((c) => c.h));
    const vmax = Math.max(...candles.map((c) => c.v));
    const step = (W - PAD * 2) / candles.length;
    const y = (p: number) => PAD + (1 - (p - min) / (max - min || 1)) * (H - PAD * 2);
    const bars = candles.map((c, i) => ({
      x: PAD + i * step + step / 2,
      w: Math.max(step * 0.6, 1),
      yo: y(c.o), yc: y(c.c), yh: y(c.h), yl: y(c.l),
      vh: (c.v / vmax) * VH,
      up: c.c >= c.o,
    }));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ p: min + (max - min) * f, y: y(min + (max - min) * f) }));
    return { bars, ticks, min, max };
  }, [candles]);
  const last = candles[candles.length - 1];
  const yLast = PAD + (1 - (last.c - min) / (max - min || 1)) * (H - PAD * 2);

  return (
    <svg className="chart" viewBox={`0 0 ${W + 70} ${H + VH + 24}`} role="img" aria-label="Biểu đồ nến">
      {ticks.map((t) => (
        <g key={t.y}>
          <line x1={0} x2={W} y1={t.y} y2={t.y} className="grid" />
          <text x={W + 6} y={t.y + 4} className="axis">{fmt(t.p, t.p > 1000 ? 0 : 2)}</text>
        </g>
      ))}
      {bars.map((b, i) => (
        <g key={i} className={b.up ? "up" : "down"}>
          <line x1={b.x} x2={b.x} y1={b.yh} y2={b.yl} />
          <rect x={b.x - b.w / 2} y={Math.min(b.yo, b.yc)} width={b.w} height={Math.max(Math.abs(b.yc - b.yo), 1)} />
          <rect x={b.x - b.w / 2} y={H + 20 + VH - b.vh} width={b.w} height={b.vh} className="vol" />
        </g>
      ))}
      <line x1={0} x2={W} y1={yLast} y2={yLast} className="last-line" />
      <rect x={W + 2} y={yLast - 10} width={66} height={20} rx={4} className="last-tag" />
      <text x={W + 6} y={yLast + 4} className="last-text">{fmt(last.c, last.c > 1000 ? 0 : 2)}</text>
      <text x={0} y={H + VH + 22} className="axis">{vnTime(candles[0].t)}</text>
      <text x={W} y={H + VH + 22} className="axis" textAnchor="end">{vnTime(last.t)}</text>
    </svg>
  );
}

function Calculator({ price, isSol }: { price: number | null; isSol: boolean }) {
  const [side, setSide] = useState<1 | -1>(1);
  const [entry, setEntry] = useState("118.36");
  const [margin, setMargin] = useState("37.66");
  const [lev, setLev] = useState("15");
  const [tp, setTp] = useState("120");
  const [sl, setSl] = useState("116.8");

  const r = useMemo(() => {
    const e = +entry, m = +margin, l = +lev, t = +tp, s = +sl;
    if (!(e > 0 && m > 0 && l > 0)) return null;
    const notional = m * l;
    const size = notional / e;
    const fees = notional * TAKER_FEE * 2;
    const pnl = (exit: number) => side * (exit - e) * size - fees;
    const win = t > 0 ? pnl(t) : null;
    const loss = s > 0 ? pnl(s) : null;
    const liq = e * (1 - side / l);
    const needed = t > 0 ? t / e - 1 : null;
    const upnl = price ? side * (price - e) * size : null;
    return { notional, size, fees, win, loss, liq, needed, upnl, rr: win !== null && loss ? win / -loss : null };
  }, [entry, margin, lev, tp, sl, side, price]);

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(",", "."))} />
    </label>
  );

  return (
    <section className="card">
      <header className="card-head">
        <h2>Tính lệnh</h2>
        <div className="seg">
          <button className={side === 1 ? "on long" : ""} onClick={() => setSide(1)}>Long</button>
          <button className={side === -1 ? "on short" : ""} onClick={() => setSide(-1)}>Short</button>
        </div>
      </header>
      <div className="fields">
        {field("Giá vào", entry, setEntry)}
        {field("Ký quỹ ($)", margin, setMargin)}
        {field("Đòn bẩy (x)", lev, setLev)}
        {field("Chốt lời", tp, setTp)}
        {field("Dừng lỗ (để trống = không có)", sl, setSl)}
      </div>
      {r && (
        <dl className="results">
          <div><dt>Vị thế</dt><dd>{fmt(r.notional)}$ · {fmt(r.size, 2)} coin</dd></div>
          <div><dt>Phí mở + đóng (taker)</dt><dd>{fmt(r.fees)}$</dd></div>
          {r.upnl !== null && <div><dt>PNL hiện tại (chưa phí)</dt><dd className={r.upnl >= 0 ? "pos" : "neg"}>{r.upnl >= 0 ? "+" : ""}{fmt(r.upnl)}$</dd></div>}
          {r.win !== null && <div><dt>Chạm chốt lời</dt><dd className="pos">+{fmt(r.win)}$</dd></div>}
          <div>
            <dt>{r.loss !== null ? "Chạm dừng lỗ" : "Không dừng lỗ: thanh lý ước tính"}</dt>
            <dd className="neg">{r.loss !== null ? `${fmt(r.loss)}$` : `${fmt(r.liq)} (mất ~${fmt(+margin)}$)`}</dd>
          </div>
          {r.rr !== null && (
            <div><dt>Lời / lỗ</dt><dd className={r.rr >= 1 ? "pos" : "neg"}>1 : {fmt(1 / r.rr, 1)} {r.rr < 0.5 ? "· cần thắng rất nhiều lần mới hòa" : ""}</dd></div>
          )}
          {r.win !== null && r.loss !== null && r.loss < 0 && (
            <div><dt>Tỷ lệ thắng tối thiểu để hòa vốn</dt><dd>{fmt((-r.loss / (r.win - r.loss)) * 100, 0)}%</dd></div>
          )}
          {isSol && r.needed !== null && (
            <div><dt>BTC cần chạy khoảng (beta {SOL_BTC_BETA})</dt><dd>{pct(r.needed / SOL_BTC_BETA)}</dd></div>
          )}
          <div><dt>Thanh lý ước tính</dt><dd>{fmt(r.liq)}</dd></div>
        </dl>
      )}
      <p className="note">Thanh lý là ước tính (chưa tính ký quỹ duy trì). Xem giá chính xác trên OKX.</p>
    </section>
  );
}

const FINDINGS = [
  ["Phí là kẻ thù chính", "Với phí taker 0,05%/chiều, vào lệnh ngẫu nhiên trên SOL lỗ ~0,6$/lệnh (vị thế 600$). Lệnh limit (maker) cắt phần lớn khoản này."],
  ["Gồng không dừng lỗ", "Target 5$: ~86% lệnh về target, ~14% cháy (~37$). Trung bình vẫn âm khoảng 1$/lệnh."],
  ["Đòn bẩy cao", "Phí tính theo giá trị vị thế: 15x lỗ ~0,6$/lệnh, 30x ~1,3$, 50x ~2,3$ với cùng target."],
  ["BTC dẫn SOL?", "Tương quan 0,72 nhưng chạy cùng lúc, không chạy trước. Sau 1h BTC giảm ≥1%, SOL hồi trung bình +0,26% trong 4 giờ."],
  ["Khung thời gian", "15m lỗ nặng nhất vì nhiều lệnh; 4h tốt hơn rõ rệt nhưng chưa ổn định qua các năm."],
];

type Stats = { n: number; winRate?: number; expR?: number; medianRiskPct?: number; symbolsPositive?: number; yearsPositive?: number };
type FeeStats = Record<"taker" | "maker", { train: Stats; test: Stats }>;
const BOOK = playbook as unknown as { setups: Record<string, Record<string, Record<string, FeeStats>>> };
const BAR_KEY: Record<string, string> = { "15m": "15m", "1H": "1h" };
const MULTS = ["1.0", "1.5", "2.0"];

function hasEdge(s: { train: Stats; test: Stats }) {
  return (s.train.expR ?? -1) > 0 && (s.test.expR ?? -1) > 0 && s.test.n >= 50 && (s.train.symbolsPositive ?? 0) >= 0.6;
}

function Guidance({ candles, bar, fetchedAt }: { candles: Candle[]; bar: string; fetchedAt: number }) {
  const [fee, setFee] = useState<"taker" | "maker">("taker");
  const closed = useMemo(() => candles.filter((c) => c.closed), [candles]);
  const signals = useMemo(() => detect(closed, 3), [closed]);
  const ctx = useMemo(() => context(closed), [closed]);
  const price = candles[candles.length - 1].c;
  const key = BAR_KEY[bar];
  const d = price > 1000 ? 1 : price > 1 ? 2 : 6;

  return (
    <section className="card">
      <header className="card-head">
        <h2>Hướng dẫn · {vnTime(fetchedAt)}</h2>
        <div className="seg">
          <button className={fee === "taker" ? "on" : ""} onClick={() => setFee("taker")}>Lệnh market</button>
          <button className={fee === "maker" ? "on" : ""} onClick={() => setFee("maker")}>Lệnh limit</button>
        </div>
      </header>

      <p className="ctx">
        Bối cảnh: giá {ctx.aboveEma200 ? "trên" : "dưới"} EMA200 ({fmt(ctx.ema200, d)}) → xu hướng {ctx.aboveEma200 ? "tăng" : "giảm"} ·
        RSI14 {ctx.rsi.toFixed(0)} · biên độ nến (ATR) {(ctx.atrPct * 100).toFixed(2)}% ·
        vùng 48 nến {fmt(ctx.low48, d)} – {fmt(ctx.high48, d)}
      </p>

      {!key && <p className="verdict neutral">Khung 4h chưa có thống kê (chỉ đo 15m và 1h). Chuyển sang 15m hoặc 1h để có hướng dẫn.</p>}

      {key && signals.length === 0 && (
        <p className="verdict neutral">Không có setup nào trong 3 nến gần nhất. <b>Đứng ngoài, chờ setup.</b> Vào lệnh không có setup chính là vào lệnh ngẫu nhiên, mà ngẫu nhiên thì thua phí.</p>
      )}

      {key && signals.map((s, idx) => {
        const st = BOOK.setups[s.setup]?.[key];
        const rnd = BOOK.setups[`random:${s.setup}`]?.[key];
        const risk = Math.abs(price - s.stop);
        const riskPct = risk / price;
        const stale = s.side > 0 ? price <= s.stop : price >= s.stop;
        const best = st ? MULTS.reduce((a, m) => ((st[m][fee].train.expR ?? -9) > (st[a][fee].train.expR ?? -9) ? m : a), MULTS[0]) : null;
        const edge = best && st ? hasEdge(st[best][fee]) : false;
        return (
          <article key={idx} className="signal">
            <header>
              <span className={`pill ${s.side > 0 ? "long" : "short"}`}>{s.side > 0 ? "LONG" : "SHORT"}</span>
              <h3>{SETUP_INFO[s.setup].title}</h3>
              <span className="muted">{s.barsAgo === 0 ? "nến vừa đóng" : `${s.barsAgo} nến trước`} ({vnTime(s.barTime)})</span>
            </header>
            <p className="muted">{SETUP_INFO[s.setup].desc}</p>
            {stale ? (
              <p className="verdict bad">Giá đã chạm mức dừng lỗ của setup ({fmt(s.stop, d)}). Setup đã hỏng, bỏ qua.</p>
            ) : (
              <>
                <div className="levels">
                  <div><span>Vào (giá hiện tại)</span><b>{fmt(price, d)}</b></div>
                  <div><span>Dừng lỗ</span><b className="neg">{fmt(s.stop, d)}</b><em>{(riskPct * 100).toFixed(2)}%</em></div>
                  {MULTS.map((m) => (
                    <div key={m}><span>Chốt lời {m.replace(".0", "")}R</span><b className="pos">{fmt(price + s.side * +m * risk, d)}</b><em>{(riskPct * +m * 100).toFixed(2)}%</em></div>
                  ))}
                </div>
                {st ? (
                  <table className="stats-table">
                    <thead><tr><th>Chốt lời</th><th>Thắng</th><th>Lời TB / lệnh</th><th>2026</th><th>Coin có lãi</th><th>Ngẫu nhiên</th></tr></thead>
                    <tbody>
                      {MULTS.map((m) => {
                        const x = st[m][fee];
                        const r = rnd?.[m]?.[fee].train;
                        return (
                          <tr key={m} className={m === best ? "best" : ""}>
                            <td>{m.replace(".0", "")}R</td>
                            <td>{x.train.winRate != null ? `${(x.train.winRate * 100).toFixed(0)}%` : "—"}</td>
                            <td className={(x.train.expR ?? 0) > 0 ? "pos" : "neg"}>{x.train.expR?.toFixed(3) ?? "—"}R</td>
                            <td className={(x.test.expR ?? 0) > 0 ? "pos" : "neg"}>{x.test.expR?.toFixed(3) ?? "—"}R ({x.test.n})</td>
                            <td>{x.train.symbolsPositive != null ? `${(x.train.symbolsPositive * 100).toFixed(0)}%` : "—"}</td>
                            <td className="muted">{r?.expR?.toFixed(3) ?? "—"}R</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <p className="muted">Chưa có thống kê cho setup này.</p>}
                {st && best && (
                  <p className={`verdict ${edge ? "good" : "bad"}`}>
                    {edge
                      ? <>Có lợi thế thống kê với chốt lời {best.replace(".0", "")}R: {st[best][fee].train.n} lệnh 2023–2025, lời TB {st[best][fee].train.expR}R/lệnh sau phí, 2026 vẫn dương. Nếu vào, giữ đúng dừng lỗ.</>
                      : <>Chưa có lợi thế: sau phí, setup này không thắng ổn định qua các năm và các coin (lời TB tốt nhất {st[best][fee].train.expR}R/lệnh). <b>Nên đứng ngoài</b> hoặc chỉ vào lệnh rất nhỏ.</>}
                  </p>
                )}
              </>
            )}
          </article>
        );
      })}
      <p className="note">1R = khoảng cách từ giá vào tới dừng lỗ. &quot;Lời TB 0,1R&quot; nghĩa là mỗi lệnh trung bình lời 10% số tiền bạn chấp nhận mất. Thống kê đo trên 20 coin Binance perp, đóng lệnh trước 0h.</p>
    </section>
  );
}

export default function Home() {
  const [inst, setInst] = useState(INSTRUMENTS[0].id);
  const [bar, setBar] = useState(BARS[0].id);
  const [data, setData] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?inst=${inst}&bar=${bar}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu");
    }
  }, [inst, bar]);

  // load once when the coin/timeframe changes; afterwards only on "Phân tích"
  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const tk = data?.ticker;
  const change = tk ? tk.last / tk.open24h - 1 : 0;
  const label = INSTRUMENTS.find((i) => i.id === inst)!.label;
  const shown = data && data.inst === inst && data.bar === bar ? data : null;

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>✦</span>
          <div>
            <h1>Northstar Crypto Lab</h1>
            <p>Nến thật từ OKX · đối chiếu với thống kê 20 coin 2023–2026</p>
          </div>
        </div>
        <div className="controls">
          <div className="seg">
            {INSTRUMENTS.map((i) => (
              <button key={i.id} className={inst === i.id ? "on" : ""} onClick={() => setInst(i.id)}>{i.label}</button>
            ))}
          </div>
          <div className="seg">
            {BARS.map((b) => (
              <button key={b.id} className={bar === b.id ? "on" : ""} onClick={() => setBar(b.id)}>{b.label}</button>
            ))}
          </div>
          <button className="primary" onClick={load}>Phân tích</button>
        </div>
      </header>

      {error && <div className="banner">Không lấy được dữ liệu OKX: {error}. Trang không hiển thị giá giả.</div>}

      <section className="stats">
        <div className="stat">
          <span>{label}/USDT perp</span>
          <strong>{tk ? fmt(tk.last, tk.last > 1000 ? 1 : 2) : "—"}</strong>
          <em className={change >= 0 ? "pos" : "neg"}>{tk ? `${pct(change)} 24h` : ""}</em>
        </div>
        <div className="stat">
          <span>Cao / thấp 24h</span>
          <strong>{tk ? `${fmt(tk.high24h, tk.last > 1000 ? 0 : 2)} / ${fmt(tk.low24h, tk.last > 1000 ? 0 : 2)}` : "—"}</strong>
        </div>
        <div className="stat">
          <span>Funding</span>
          <strong className={data && Math.abs(data.funding.rate) >= 0.0003 ? "neg" : ""}>{data ? `${(data.funding.rate * 100).toFixed(4)}%` : "—"}</strong>
          <em>{data ? `trả lúc ${vnTime(data.funding.nextTime)}` : ""}</em>
        </div>
        <div className="stat">
          <span>Open interest</span>
          <strong>{data ? `${fmt(data.openInterest.usd / 1e6, 0)} tr$` : "—"}</strong>
        </div>
        <div className="stat">
          <span>BTC · nến 1h vừa đóng</span>
          <strong>{data?.btcLast ? fmt(data.btcLast, 0) : "—"}</strong>
          <em className={(data?.btc1hMove ?? 0) >= 0 ? "pos" : "neg"}>{data?.btc1hMove != null ? pct(data.btc1hMove) : ""}</em>
        </div>
      </section>

      <div className="grid">
        <div className="main-col">
        <section className="card chart-card">
          <header className="card-head">
            <h2>{label} · {BARS.find((b) => b.id === bar)!.label}</h2>
            <span className="muted">
              {shown?.volumeRatio != null ? `Khối lượng nến vừa đóng: ${shown.volumeRatio.toFixed(1)}× trung bình` : ""}
            </span>
          </header>
          {shown && shown.candles.length > 0 ? <CandleChart candles={shown.candles.slice(-120)} /> : <div className="empty">Đang tải nến…</div>}
        </section>
        {shown && <Guidance candles={shown.candles} bar={bar} fetchedAt={shown.fetchedAt} />}
        </div>

        <aside className="side">
          <section className="card">
            <header className="card-head"><h2>Cảnh báo</h2>{data && <span className="muted">{vnTime(data.fetchedAt)}</span>}</header>
            <ul className="alerts">
              {(shown?.alerts ?? []).map((a, i) => <li key={i} className={a.level}>{a.text}</li>)}
            </ul>
          </section>
          <Calculator price={tk?.last ?? null} isSol={inst === "SOL-USDT-SWAP"} />
        </aside>
      </div>

      <section className="card">
        <header className="card-head"><h2>Kết quả backtest (SOL, BTC, ETH 2022–2026)</h2></header>
        <div className="findings">
          {FINDINGS.map(([t, d]) => (
            <article key={t}><h3>{t}</h3><p>{d}</p></article>
          ))}
        </div>
      </section>

      <footer className="foot">Chỉ để nghiên cứu, không phải lời khuyên đầu tư. Trang không đặt lệnh và không cần tài khoản sàn.</footer>
    </main>
  );
}
