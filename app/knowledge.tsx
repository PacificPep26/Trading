// Static summary of the agreed rule and the evidence behind it. Keep in sync with PLAN.md ("Kết luận hiện tại").
const TERMS: [string, string][] = [
  ["Nến 4h", "Mỗi cây nến = giá trong 4 giờ. Đóng lúc 3h, 7h, 11h, 15h, 19h, 23h giờ VN. Chỉ vào lệnh khi nến 4h đã ĐÓNG."],
  ["Đỉnh / đáy (swing)", "Điểm cao/thấp nhất so với 3 nến trước và 3 nến sau."],
  ["Xu hướng tăng / giảm", "Tăng: đỉnh sau cao hơn, đáy sau cao hơn (HH+HL). Giảm: đỉnh sau thấp hơn, đáy sau thấp hơn (LH+LL)."],
  ["BOS", "Break Of Structure, phá cấu trúc: nến đóng cửa vượt đỉnh gần nhất (LONG) hoặc thủng đáy gần nhất (SHORT)."],
  ["Hai đỉnh / hai đáy", "Giá chạm cùng một mức hai lần rồi đóng cửa thủng đường viền cổ (đáy giữa hai đỉnh / đỉnh giữa hai đáy)."],
  ["EMA50 ngày", "Giá trung bình 50 ngày. Giá đóng ngày trên EMA50 = xu hướng ngày TĂNG, dưới = GIẢM."],
  ["SL / TP", "Dừng lỗ / chốt lời. Trailing stop: SL tự dời theo giá để giữ lời."],
  ["R", "Số tiền mất nếu chạm SL. Chốt 1,5R = lời gấp 1,5 lần số tiền chịu mất."],
  ["Đòn bẩy, thanh lý", "Vị thế = ký quỹ × đòn bẩy. Giá thanh lý phải nằm XA hơn SL, nếu không sẽ cháy trước khi chạm SL."],
  ["Funding", "Phí trao đổi giữa phe long và short mỗi 8 giờ trên hợp đồng vĩnh cửu."],
  ["t (độ tin cậy)", "t ≥ 3 mới coi là chắc; t ≈ 1–2 là có thể, chưa chắc."],
];

export default function Knowledge() {
  return (
    <details className="more-tools">
      <summary>Luật & kiến thức (bấm để mở)</summary>

      <section className="kb">
        <h3>1. Luật duy nhất</h3>
        <ol>
          <li><b>Chỉ vào khi nến 4h vừa ĐÓNG xác nhận tín hiệu</b> và giá chưa chạy quá 0,5R. Không có tín hiệu = đứng ngoài.</li>
          <li><b>BOS 4h: chỉ LONG.</b> BOS SHORT không có lợi thế.</li>
          <li><b>Hai đỉnh / hai đáy 4h: chỉ cùng xu hướng ngày</b> của BTC và của coin (EMA50 ngày): trên → chỉ hai đáy LONG; dưới → chỉ hai đỉnh SHORT.</li>
          <li><b>SL</b> ở cấu trúc 4h (thường cách 4–8%). <b>TP: chốt cả ở 0,5R</b> (long và short, thắng ~62%). Lời mỏng nên <b>chỉ đánh coin phí 0% trên MEXC</b>, ưu tiên lệnh limit.</li>
          <li><b>Giữ</b> nửa ngày – 2 ngày. Không đóng tay vì giá đi ngang buổi trưa; phiên Mỹ (sau 20h30) thường chạy mạnh.</li>
          <li><b>Ưu tiên coin phí 0%</b> trên MEXC (LINK, APT, ARB, ADA, OP, DOT, XRP, DOGE…).</li>
          <li><b>Thua 2 lệnh liên tiếp → nghỉ hết ngày.</b></li>
        </ol>

        <h3>2. Cỡ lệnh (quan trọng nhất)</h3>
        <p><b>Chạm SL chỉ mất ~2,5% vốn.</b> Công thức: <code>vị thế = 2,5% × vốn ÷ khoảng cách SL</code>; <code>đòn bẩy = vị thế ÷ ký quỹ</code>.</p>
        <p>Ví dụ vốn 40$, SL cách 6%: vị thế = 1$ ÷ 6% ≈ 17$ → dùng cả 40$ ký quỹ thì đòn bẩy ≈ 0,4x.</p>
        <p>Mô phỏng 2023–2026 (40$, 1.221 lệnh): mất 2,5%/lệnh → 40$ thành ~93$ (phí OKX), sụt tối đa ~56%. Mất 7,5%/lệnh → có lúc còn 4$ (sụt 96%). Chuỗi thua dài nhất 13 lệnh.</p>

        <h3>3. Đã kiểm chứng (21 coin, 2023–2026, đã trừ phí, trượt giá, funding)</h3>
        <table className="stats-table">
          <thead><tr><th>Kiểu</th><th>Kết quả</th><th>Dùng?</th></tr></thead>
          <tbody>
            <tr><td>BOS 4h LONG</td><td>+0,04–0,07R/lệnh, thắng ~48%</td><td className="pos">Dùng</td></tr>
            <tr><td>Hai đỉnh/đáy 4h cùng xu hướng ngày</td><td>+0,04–0,08R</td><td className="pos">Dùng</td></tr>
            <tr><td>BOS 4h SHORT</td><td>≈ 0 (−0,02R)</td><td className="neg">Không</td></tr>
            <tr><td>Mọi kiểu khung 15m / 1h (vùng hồi, Fibonacci, hỗ trợ/kháng cự, VWAP, bắt đáy, đu sóng 20x, lọc khối lượng)</td><td>−0,1 đến −0,45R</td><td className="neg">Không</td></tr>
            <tr><td>Chốt ngay trên nền cũ</td><td>thắng 75% nhưng −0,02R</td><td className="neg">Không</td></tr>
          </tbody>
        </table>
        <p className="muted">Lợi thế mỏng (t ≈ 1,4–2), có năm âm (2025). Nghiên cứu bên ngoài cũng cho thấy: momentum crypto chỉ có lời ở chiều long, và lợi thế đang yếu dần từ sau 2020.</p>

        <h3>4. Từ ngữ</h3>
        <dl className="terms">
          {TERMS.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>
    </details>
  );
}
