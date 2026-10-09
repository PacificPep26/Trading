const TERMS: [string, string][] = [
  ["Decision engine", "Nguồn quyết định duy nhất cho scanner, Telegram và paper ledger."],
  ["R", "Số tiền dự kiến mất khi chạm dừng lỗ."],
  ["Paper", "Mô phỏng lệnh và tài khoản; không gửi lệnh tới sàn."],
  ["Drawdown", "Mức equity giảm từ đỉnh gần nhất. Đạt 20% thì khóa entry mới."],
];

export default function Knowledge() {
  return (
    <details className="more-tools">
      <summary>Policy paper-v1.0.0 (bấm để mở)</summary>
      <section className="kb">
        <h3>Setup được paper</h3>
        <ol>
          <li><b>BOS 4H chỉ LONG</b>, xác nhận bằng nến đã đóng.</li>
          <li><b>Hai đỉnh/đáy 4H</b> chỉ khi BTC và coin cùng hướng ngày với lệnh.</li>
          <li>BOS SHORT, pinbar và mọi entry 1H không được tạo paper order.</li>
        </ol>

        <h3>Quản trị vốn</h3>
        <p>Isolated tối đa x10. Vị thế tự giảm theo khoảng SL để lỗ tối đa 10% equity; drawdown 20% khóa lệnh mới.</p>
        <p>TP1 đóng 50% ở 0,5R; TP2 đóng phần còn lại ở 1R. Nếu cùng nến chạm SL và TP, ledger tính SL trước.</p>

        <h3>Trạng thái kiểm chứng</h3>
        <p>Lịch sử chỉ là exploratory vì dữ liệu 2026 đã được xem nhiều lần. Chưa cân nhắc tiền thật trước khi đủ 200 lệnh đóng và 3 tháng paper, expectancy ròng dương, profit factor trên 1 và drawdown dưới 20%.</p>

        <dl className="terms">
          {TERMS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>
    </details>
  );
}
