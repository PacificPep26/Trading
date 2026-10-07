"use client";

import { useEffect, useState } from "react";

type Setup = { style: "bos" | "double_top_bottom"; state: "triggered" | "pending"; side: 1 | -1; entry: number; stop: number; tp15: number; tp2: number; target?: number; distancePct: number };
type Coin = { coin: string; trend: -1 | 0 | 1; close: number; atrPct: number; lastBarTime: number; setups: Setup[] };
type Stat = { n: number; winRate?: number; expR?: number; coinsPositive?: number; expR2026?: number };
type Data = { coins: Coin[]; failed: string[]; stats: Record<string, Stat>; fetchedAt: number };

const STYLE = { bos: "Phá cấu trúc (BOS)", double_top_bottom: "Hai đỉnh / hai đáy" };
const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const vn = (t: number) => new Date(t).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

export default function WatchlistCard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [margin, setMargin] = useState("40");
  const [riskUsd, setRiskUsd] = useState("2");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, []);

  const rows = (data?.coins ?? [])
    .flatMap((c) => c.setups.map((s) => ({ c, s })))
    .sort((a, b) => (a.s.state === b.s.state ? Math.abs(a.s.distancePct) - Math.abs(b.s.distancePct) : a.s.state === "triggered" ? -1 : 1));
  const quiet = (data?.coins ?? []).filter((c) => c.setups.length === 0).map((c) => c.coin);

  return (
    <section className="card watchlist">
      <header className="card-head">
        <h2>Coin đáng chú ý · khung 4h</h2>
        <button className="primary" onClick={load} disabled={loading}>{loading ? "Đang quét…" : "Quét lại"}</button>
      </header>
      <p className="muted">
        Chỉ quét 2 kiểu tốt nhất qua kiểm chứng (21 coin, 2023–2026). Đây là hai kiểu duy nhất gần có lãi sau phí, <b>lợi thế còn mỏng, chưa chắc chắn</b>.
        {data && <> Nến 4h đóng gần nhất: {vn(data.coins[0]?.lastBarTime ?? data.fetchedAt)}.</>}
      </p>
      {data && (
        <div className="style-stats">
          {Object.entries(STYLE).map(([k, title]) => {
            const s = data.stats[k];
            return s ? <span key={k}>{title}: thắng {((s.winRate ?? 0) * 100).toFixed(0)}% · {s.expR?.toFixed(3)}R/lệnh · 2026 {s.expR2026?.toFixed(3)}R · {((s.coinsPositive ?? 0) * 100).toFixed(0)}% coin lãi</span> : null;
          })}
        </div>
      )}
      <div className="sizing">
        <label>Ký quỹ ($)<input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(",", "."))} /></label>
        <label>Chấp nhận mất mỗi lệnh ($)<input inputMode="decimal" value={riskUsd} onChange={(e) => setRiskUsd(e.target.value.replace(",", "."))} /></label>
        <span className="muted">Đòn bẩy được tính để chạm dừng lỗ thì mất đúng số tiền này (đã gồm phí 0,1%).</span>
      </div>
      {error && <p className="verdict bad">{error}</p>}
      {rows.length === 0 && data && <p className="verdict neutral">Không coin nào đang có hoặc sắp có setup hợp lệ. Đứng ngoài.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="stats-table watch-table">
            <thead>
              <tr><th>Coin</th><th>Kiểu</th><th>Trạng thái</th><th>Vào</th><th>Dừng lỗ</th><th>Chốt 1,5R</th><th>Chốt 2R</th><th>Rủi ro</th><th>Đòn bẩy</th><th>Lời 1,5R / 2R</th></tr>
            </thead>
            <tbody>
              {rows.map(({ c, s }, idx) => {
                const risk = Math.abs(s.entry - s.stop) / s.entry;
                const notional = +riskUsd / (risk + 0.001); // loss at the stop incl. round-trip fee = riskUsd
                const lev = notional / (+margin || 1);
                return (
                  <tr key={idx} className={s.state === "triggered" ? "best" : ""}>
                    <td><b>{c.coin}</b> <span className={`pill ${s.side > 0 ? "long" : "short"}`}>{s.side > 0 ? "LONG" : "SHORT"}</span></td>
                    <td>{STYLE[s.style]}</td>
                    <td>{s.state === "triggered" ? "Vừa kích hoạt" : `Chờ: cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%`}</td>
                    <td>{s.state === "triggered" ? fmt(s.entry) : <>{s.side > 0 ? "Đóng nến 4h trên" : "Đóng nến 4h dưới"} {fmt(s.entry)}</>}</td>
                    <td className="neg">{fmt(s.stop)}</td>
                    <td className="pos">{fmt(s.tp15)}</td>
                    <td className="pos">{fmt(s.tp2)}</td>
                    <td>{(risk * 100).toFixed(2)}%</td>
                    <td className={lev * risk >= 0.8 ? "neg" : ""}>{lev < 1 ? `${notional.toFixed(0)}$ (<1x)` : `${lev.toFixed(1)}x`}</td>
                    <td className="pos">+{(notional * (1.5 * risk - 0.001)).toFixed(1)}$ / +{(notional * (2 * risk - 0.001)).toFixed(1)}$</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {quiet.length > 0 && <p className="muted">Không có setup: {quiet.join(", ")}.</p>}
      <p className="note">
        &quot;Chờ&quot; nghĩa là setup chỉ hợp lệ khi <b>nến 4h đóng cửa</b> vượt qua mức vào (không phải chỉ chạm râu). Rủi ro = khoảng cách vào → dừng lỗ;
        với 15x, rủi ro 2% nghĩa là mất ~30% ký quỹ nếu chạm dừng lỗ, nên giảm đòn bẩy khi rủi ro lớn.
      </p>
    </section>
  );
}
