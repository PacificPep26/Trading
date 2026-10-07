"use client";

import { useState } from "react";

type Plan = { entryType: string; entry: number; stop: number; tp1: number; tp2: number; invalidation: string; condition: string };
type Result = {
  price: number;
  cached?: boolean;
  fetchedAt: number;
  analysis: { verdict: "LONG" | "SHORT" | "ĐỨNG NGOÀI"; confidence: string; summary: string; plan: Plan | null; reasons: string[]; risks: string[] };
};

const fmt = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 6 });

export default function AiCard({ inst }: { inst: string }) {
  const [state, setState] = useState<{ loading: boolean; data?: Result; error?: string }>({ loading: false });

  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch(`/api/ai-analysis?inst=${inst}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState({ loading: false, data: body });
    } catch (e) {
      setState({ loading: false, error: e instanceof Error ? e.message : "Lỗi" });
    }
  }

  const a = state.data?.analysis;
  const p = a?.plan;
  const tone = a?.verdict === "LONG" ? "long" : a?.verdict === "SHORT" ? "short" : "flat";
  const r = p ? Math.abs(p.entry - p.stop) : 0;

  return (
    <section className="card ai-card">
      <header className="card-head">
        <h2>AI phân tích · {inst.split("-")[0]}</h2>
        <button className="primary" onClick={run} disabled={state.loading}>{state.loading ? "Đang phân tích…" : "Phân tích bằng AI"}</button>
      </header>
      {state.error && <p className="verdict bad">{state.error}</p>}
      {!a && !state.error && <p className="muted">AI đọc nến 15m/1h/4h, BTC, funding, rồi đối chiếu với kết quả kiểm chứng 10 kiểu phân tích trên 21 coin. Mỗi lần mất khoảng 20–60 giây.</p>}
      {a && (
        <>
          <div className={`ai-verdict ${tone}`}>
            <strong>{a.verdict}</strong>
            <span>Độ tin cậy: {a.confidence}</span>
          </div>
          <p>{a.summary}</p>
          {p && (
            <>
              <div className="levels">
                <div><span>{p.entryType === "vào ngay" ? "Vào ngay" : "Chờ giá về"}</span><b>{fmt(p.entry)}</b></div>
                <div><span>Dừng lỗ</span><b className="neg">{fmt(p.stop)}</b><em>{((r / p.entry) * 100).toFixed(2)}%</em></div>
                <div><span>Chốt lời 1</span><b className="pos">{fmt(p.tp1)}</b><em>{r ? (Math.abs(p.tp1 - p.entry) / r).toFixed(1) : "—"}R</em></div>
                <div><span>Chốt lời 2</span><b className="pos">{fmt(p.tp2)}</b><em>{r ? (Math.abs(p.tp2 - p.entry) / r).toFixed(1) : "—"}R</em></div>
              </div>
              <p className="muted"><b>Điều kiện vào:</b> {p.condition}</p>
              <p className="muted"><b>Kế hoạch hỏng khi:</b> {p.invalidation}</p>
            </>
          )}
          <div className="reasons">
            <div><h3>Lý do</h3>{a.reasons.map((x) => <p key={x}>✓ {x}</p>)}</div>
            <div><h3>Rủi ro</h3>{a.risks.map((x) => <p key={x}>⚠ {x}</p>)}</div>
          </div>
          <p className="note">
            Giá lúc phân tích {fmt(state.data!.price)} · {new Date(state.data!.fetchedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
            {state.data!.cached ? " · kết quả lưu tạm (≤3 phút)" : ""}. Chưa kiểu vào lệnh nào có lợi thế đã chứng minh: luôn đặt dừng lỗ.
          </p>
        </>
      )}
    </section>
  );
}
