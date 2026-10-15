"use client";

// Trạng thái 3 kèo của 21 coin (dữ liệu /api/watchlist, làm mới mỗi 5 phút). Tin báo chính nằm ở Telegram.
import { useEffect, useState } from "react";

type Limit = { status: string; limit: number; stop: number; tp: number };
type Snap = {
  coin: string; price: number | null; daily: number;
  ict?: Limit; limit?: Limit;
  swing?: { side: number; entry: number; stop: number };
  pending4h: { side: number; trigger: number; stop: number; distancePct: number }[];
};

const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const lim = (x?: Limit) => (x ? `${x.status === "open" ? "mở" : "chờ"} ${fmt(x.limit)} · SL ${fmt(x.stop)} · TP ${fmt(x.tp)}` : "—");

export default function LiveScanner() {
  const [data, setData] = useState<{ coins: Snap[]; failed: string[]; fetchedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/watchlist", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { setData(d); setError(null); })
        .catch((e) => setError(String(e)));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="logo">📈</div>
          <div>
            <h1>3 kèo đã kiểm chứng</h1>
            <span className="muted">🎯 ICT quét đỉnh hôm qua → SHORT 1H · 📌 Limit dưới đáy 1H → LONG · 📊 Hai đỉnh/đáy 4H, SL trailing 3 ATR</span>
          </div>
        </div>
      </header>
      {error && <div className="banner">Lỗi tải dữ liệu: {error}</div>}
      <section className="card">
        <div className="card-head">
          <b>21 coin</b>
          <span className="muted">{data ? `cập nhật ${new Date(data.fetchedAt).toLocaleTimeString("vi-VN")}` : "đang tải…"}</span>
        </div>
        <table className="stats-table">
          <thead>
            <tr><th>Coin</th><th>Giá</th><th>Ngày</th><th>🎯 ICT</th><th>📌 Limit</th><th>📊 4H</th></tr>
          </thead>
          <tbody>
            {data?.coins.map((s) => (
              <tr key={s.coin}>
                <td><b>{s.coin}</b></td>
                <td>{s.price ? fmt(s.price) : "—"}</td>
                <td className={s.daily > 0 ? "pos" : s.daily < 0 ? "neg" : ""}>{s.daily > 0 ? "tăng" : s.daily < 0 ? "giảm" : "—"}</td>
                <td>{lim(s.ict)}</td>
                <td>{lim(s.limit)}</td>
                <td>
                  {s.swing
                    ? `${s.swing.side > 0 ? "LONG" : "SHORT"} mở · vào ${fmt(s.swing.entry)} · SL ${fmt(s.swing.stop)}`
                    : s.pending4h.map((p) => `${p.side > 0 ? "hai đáy" : "hai đỉnh"} chờ ${fmt(p.trigger)} (${(Math.abs(p.distancePct) * 100).toFixed(1)}%)`).join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.failed.length ? <p className="note">Không tải được: {data.failed.join(", ")}</p> : null}
      </section>
      <p className="foot">Chỉ báo tin — vào lệnh tay. Chi tiết luật: docs/bot-spec.md · sổ tay: docs/so-tay-kien-thuc.md</p>
    </>
  );
}
