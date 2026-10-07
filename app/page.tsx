"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AiCard from "./ai-card";
import WatchlistCard from "./watchlist-card";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean };
type Frame = { bar: string; close: number; ema20: number; ema50: number; ema200: number; rsi: number; atr: number; volumeRatio: number; support: number; resistance: number; move: number; impulseAtr: number; impulseBarsAgo: number };
type Probability = { probability: number; low: number; high: number; samples: number; unresolved: number; scope: string; stopAtr: number; rr: number; source: string };
type PositionAnalysis = { action: string; tone: string; probability: Probability | null; timing: { state: string; text: string }; supports: string[]; risks: string[]; win: number; loss: number; breakeven: number; rrAfterFee: number; unrealized: number; fee: number };
type Scan = { side: "long" | "short"; entry: number; stop: number; best?: { rr: number; tp: number; probability: Probability }; timing: { state: string; text: string }; qualified: boolean; verdict: string };
type Analysis = { inst: string; ticker: { last: number; open24h: number; high24h: number; low24h: number }; funding: { rate: number; nextTime: number }; openInterest: { usd: number }; oiChange4h: number | null; longShortRatio: number | null; candles: Record<string, Candle[]>; frames: Record<string, Frame>; btcReturn1h: number; scanner: Scan[]; positionAnalysis: PositionAnalysis | null; news: { items: { title: string; link: string; source: string; published?: string }[]; warning?: string }; fetchedAt: number };
type Position = { id: string; inst_id: string; side: "long" | "short"; entry: number; tp: number; sl: number; margin: number; leverage: number; status: "open" | "closed"; opened_at: string };
type Form = { side: "long" | "short"; entry: string; tp: string; sl: string; margin: string; leverage: string };

const INSTRUMENTS = ["SOL", "BTC", "ETH", "HYPE"];
const BARS = ["15m", "1H", "4H"];
const DEFAULT: Form = { side: "short", entry: "117.18", tp: "115", sl: "119", margin: "40", leverage: "15" };
const fmt = (x: number, d = 2) => x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const vnTime = (x: number | string) => new Date(x).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

function CandleChart({ candles }: { candles: Candle[] }) {
  const W = 900, H = 300, VH = 52, P = 8;
  const model = useMemo(() => {
    const cs = candles.slice(-120), lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
    const vmax = Math.max(...cs.map((c) => c.v)), step = (W - P * 2) / cs.length;
    const y = (price: number) => P + (1 - (price - lo) / (hi - lo || 1)) * (H - P * 2);
    return { cs, lo, hi, y, step, vmax };
  }, [candles]);
  const last = model.cs.at(-1)!;
  return <svg className="chart" viewBox={`0 0 ${W + 72} ${H + VH + 24}`} role="img" aria-label="Biểu đồ nến">
    {[0,.25,.5,.75,1].map((f) => { const price = model.lo + (model.hi - model.lo) * f, y = model.y(price); return <g key={f}><line className="grid" x1="0" x2={W} y1={y} y2={y}/><text className="axis" x={W+6} y={y+4}>{fmt(price, price > 1000 ? 0 : 2)}</text></g>; })}
    {model.cs.map((c,i) => { const x=P+i*model.step+model.step/2, yo=model.y(c.o), yc=model.y(c.c); return <g key={c.t} className={c.c>=c.o?"up":"down"}><line x1={x} x2={x} y1={model.y(c.h)} y2={model.y(c.l)}/><rect x={x-model.step*.3} y={Math.min(yo,yc)} width={Math.max(1,model.step*.6)} height={Math.max(1,Math.abs(yo-yc))}/><rect className="vol" x={x-model.step*.3} y={H+16+VH-c.v/model.vmax*VH} width={Math.max(1,model.step*.6)} height={c.v/model.vmax*VH}/></g>; })}
    <line className="last-line" x1="0" x2={W} y1={model.y(last.c)} y2={model.y(last.c)}/><rect className="last-tag" x={W+2} y={model.y(last.c)-10} width="68" height="20" rx="4"/><text className="last-text" x={W+6} y={model.y(last.c)+4}>{fmt(last.c,last.c>1000?0:2)}</text>
  </svg>;
}

function ProbabilityView({ value }: { value: Probability | null }) {
  if (!value) return <p className="muted">Chưa đủ tối thiểu 200 mẫu lịch sử tương đồng để báo xác suất.</p>;
  return <div className="probability"><strong>{(value.probability * 100).toFixed(1)}%</strong><span>TP trước SL</span><em>Khoảng tin cậy 95%: {(value.low*100).toFixed(1)}–{(value.high*100).toFixed(1)}% · {value.samples.toLocaleString("vi-VN")} mẫu</em></div>;
}

export default function Home() {
  const [coin, setCoin] = useState("SOL"), [bar, setBar] = useState("15m");
  const [form, setForm] = useState<Form>(DEFAULT), [positions, setPositions] = useState<Position[]>([]);
  const [formInst, setFormInst] = useState("SOL-USDT-SWAP");
  const [data, setData] = useState<Analysis | null>(null), [error, setError] = useState<string | null>(null);
  const [dbMessage, setDbMessage] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const inst = `${coin}-USDT-SWAP`;
  const numeric = useMemo(() => ({ side: form.side, entry:+form.entry, tp:+form.tp, sl:+form.sl, margin:+form.margin, leverage:+form.leverage }), [form]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ inst });
      if (formInst === inst) Object.entries(numeric).forEach(([key, value]) => q.set(key, String(value)));
      const res = await fetch(`/api/analysis?${q}`, { cache:"no-store" }), body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Không tải được dữ liệu"); }
    finally { setLoading(false); }
  }, [inst, numeric, formInst]);
  const loadPositions = useCallback(async () => {
    try { const res=await fetch("/api/positions",{cache:"no-store"}), body=await res.json(); if(!res.ok) throw new Error(body.error); setPositions(body.positions); setDbMessage(null); }
    catch(e) { setDbMessage(e instanceof Error?e.message:"Postgres chưa sẵn sàng"); }
  },[]);
  useEffect(() => { const id=setTimeout(load,0), timer=setInterval(load,60_000); return()=>{clearTimeout(id);clearInterval(timer);}; },[load]);
  useEffect(() => { const id=setTimeout(loadPositions,0); return()=>clearTimeout(id); },[loadPositions]);
  const savePosition = async () => { if(formInst!==inst){setDbMessage(`Hãy nhập thông số lệnh ${coin} trước khi lưu.`);return;} const res=await fetch("/api/positions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({instId:inst,...numeric})}); const body=await res.json(); if(!res.ok){setDbMessage(body.error);return;} setDbMessage("Đã lưu lệnh vào Postgres"); await loadPositions(); await load(); };
  const closePosition = async (id:string) => { await fetch("/api/positions",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,status:"closed"})}); await loadPositions(); };
  const selectPosition = (p:Position) => { setCoin(p.inst_id.split("-")[0]); setFormInst(p.inst_id); setForm({side:p.side,entry:String(p.entry),tp:String(p.tp),sl:String(p.sl),margin:String(p.margin),leverage:String(p.leverage)}); };
  const setField=(key:keyof Form,value:string)=>{ setFormInst(inst); setForm((x)=>({...x,[key]:value.replace(",",".")})); };
  const shown = data?.frames[bar], candles = data?.candles[bar] ?? [], pa=data?.positionAnalysis;
  return <main className="shell">
    <header className="top"><div className="brand"><span className="logo">✦</span><div><h1>Northstar Crypto Lab</h1><p>Phân tích Long/Short đa khung · tự cập nhật mỗi 60 giây</p></div></div><div className="controls"><div className="seg">{INSTRUMENTS.map((x)=><button key={x} className={coin===x?"on":""} onClick={()=>setCoin(x)}>{x}</button>)}</div><div className="seg">{BARS.map((x)=><button key={x} className={bar===x?"on":""} onClick={()=>setBar(x)}>{x.replace("H","h")}</button>)}</div><button className="primary" onClick={load}>{loading?"Đang tính…":"Phân tích"}</button></div></header>
    {error&&<div className="banner">Không lấy được dữ liệu thật: {error}</div>}
    <section className="stats"><div className="stat"><span>{coin}/USDT perp</span><strong>{data?fmt(data.ticker.last,data.ticker.last>1000?0:2):"—"}</strong><em className={data&&data.ticker.last>=data.ticker.open24h?"pos":"neg"}>{data?pct(data.ticker.last/data.ticker.open24h-1):""} 24h</em></div><div className="stat"><span>Funding</span><strong>{data?pct(data.funding.rate,4):"—"}</strong><em>{data?`Kỳ tiếp theo ${vnTime(data.funding.nextTime)}`:""}</em></div><div className="stat"><span>Open interest</span><strong>{data?`${fmt(data.openInterest.usd/1e6,0)} triệu $`:"—"}</strong><em className={(data?.oiChange4h??0)>=0?"pos":"neg"}>{data?.oiChange4h!=null?`${pct(data.oiChange4h)} trong 4h`:""}</em></div><div className="stat"><span>Tài khoản Long / Short</span><strong>{data?.longShortRatio!=null?fmt(data.longShortRatio,2):"—"}</strong><em>{data?.longShortRatio!=null?(data.longShortRatio>1?"Long đang đông hơn":"Short đang đông hơn"):""}</em></div><div className="stat"><span>BTC trong 1h</span><strong className={(data?.btcReturn1h??0)>=0?"pos":"neg"}>{data?pct(data.btcReturn1h):"—"}</strong></div></section>
    <div className="grid"><div className="main-col">
      <section className="card"><header className="card-head"><h2>{coin} · {bar.replace("H","h")}</h2>{shown&&<span className="muted">Volume {shown.volumeRatio.toFixed(2)}× · RSI {shown.rsi.toFixed(0)} · ATR {fmt(shown.atr)}</span>}</header>{candles.length?<CandleChart candles={candles}/>:<div className="empty">Đang tải nến…</div>}</section>
      {shown&&<section className="card"><header className="card-head"><h2>Bối cảnh đa khung</h2><span className="muted">Cập nhật {data&&vnTime(data.fetchedAt)}</span></header><div className="frame-grid">{Object.values(data!.frames).map((f)=><article key={f.bar}><h3>{f.bar.replace("H","h")}</h3><p className={f.close>=f.ema200?"pos":"neg"}>{f.close>=f.ema200?"Trên":"Dưới"} EMA200 {fmt(f.ema200)}</p><p>RSI {f.rsi.toFixed(0)} · Volume {f.volumeRatio.toFixed(2)}×</p><p>Hỗ trợ {fmt(f.support)} · Kháng cự {fmt(f.resistance)}</p>{Math.abs(f.impulseAtr)>=1.5&&<p className="warn-text">Có nến sâu {Math.abs(f.impulseAtr).toFixed(1)} ATR, {f.impulseBarsAgo} nến trước</p>}</article>)}</div></section>}
      <WatchlistCard />
      <AiCard inst={`${coin}-USDT-SWAP`} />
      <section className="card"><header className="card-head"><h2>Quét điểm vào mới</h2></header><div className="scanner">{(data?.scanner??[]).map((s)=><article key={s.side} className={`signal ${s.qualified?"qualified":""}`}><header><span className={`pill ${s.side}`}>{s.side.toUpperCase()}</span><h3>{s.verdict}</h3></header><p>{s.timing.text}</p><div className="levels"><div><span>Entry tham chiếu</span><b>{fmt(s.entry)}</b></div><div><span>SL cấu trúc</span><b>{fmt(s.stop)}</b></div>{s.best&&<div><span>TP tốt nhất · {s.best.rr}R</span><b>{fmt(s.best.tp)}</b></div>}</div><ProbabilityView value={s.best?.probability??null}/></article>)}</div></section>
      {pa&&<section className={`card decision ${pa.tone}`}><header className="card-head"><h2>Đánh giá lệnh đang nhập</h2><strong className="decision-tag">{pa.action}</strong></header><ProbabilityView value={pa.probability}/><p className="timing">{pa.timing.text}</p><div className="metrics"><div><span>Lãi tại TP sau phí</span><b className="pos">+{fmt(pa.win)}$</b></div><div><span>Lỗ tại SL sau phí</span><b className="neg">{fmt(pa.loss)}$</b></div><div><span>RR sau phí</span><b>{fmt(pa.rrAfterFee,2)}</b></div><div><span>Tỷ lệ hòa vốn</span><b>{(pa.breakeven*100).toFixed(1)}%</b></div><div><span>PNL chưa phí</span><b className={pa.unrealized>=0?"pos":"neg"}>{fmt(pa.unrealized)}$</b></div></div><div className="reasons"><div><h3>Ủng hộ</h3>{pa.supports.map((x)=><p key={x}>✓ {x}</p>)}</div><div><h3>Rủi ro</h3>{pa.risks.map((x)=><p key={x}>⚠ {x}</p>)}</div></div></section>}
    </div><aside className="side">
      <section className="card"><header className="card-head"><h2>Lệnh cần đánh giá</h2><div className="seg"><button className={form.side==="long"?"on long":""} onClick={()=>setField("side","long")}>Long</button><button className={form.side==="short"?"on short":""} onClick={()=>setField("side","short")}>Short</button></div></header><div className="fields">{(["entry","margin","leverage","tp","sl"] as const).map((k)=><label className="field" key={k}><span>{{entry:"Giá vào",margin:"Ký quỹ ($)",leverage:"Đòn bẩy",tp:"Chốt lời",sl:"Dừng lỗ"}[k]}</span><input inputMode="decimal" value={form[k]} onChange={(e)=>setField(k,e.target.value)}/></label>)}</div><div className="button-row"><button className="primary" onClick={load}>Đánh giá</button><button className="secondary" onClick={savePosition}>Lưu Postgres</button></div>{dbMessage&&<p className="note">{dbMessage}</p>}</section>
      <section className="card"><header className="card-head"><h2>Vị thế đang lưu</h2></header>{positions.filter((p)=>p.status==="open").length===0?<p className="muted">Chưa có vị thế mở.</p>:positions.filter((p)=>p.status==="open").map((p)=><article className="saved-position" key={p.id}><button onClick={()=>selectPosition(p)}><b>{p.side.toUpperCase()} {p.inst_id.split("-")[0]}</b><span>{fmt(p.entry)} → TP {fmt(p.tp)} / SL {fmt(p.sl)}</span></button><button className="close" onClick={()=>closePosition(p.id)}>Đóng</button></article>)}</section>
      <section className="card"><header className="card-head"><h2>Tin tức · chỉ cảnh báo</h2></header>{data?.news.warning&&<p className="warn-text">{data.news.warning}</p>}<ul className="news">{(data?.news.items??[]).map((n)=><li key={n.link}><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a><span>{n.source}</span></li>)}</ul>{data?.news.items.length===0&&<p className="muted">Chưa tải được tin. Phân tích giá vẫn hoạt động.</p>}</section>
    </aside></div><footer className="foot">Thống kê mô tả dữ liệu quá khứ, không đảm bảo kết quả tương lai. Hệ thống không tự đặt lệnh.</footer>
  </main>;
}
