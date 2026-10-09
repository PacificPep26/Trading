import Knowledge from "./knowledge";
import LiveScanner from "./live-scanner";

export default function Home() {
  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo">✦</span>
          <div>
            <h1>Northstar Crypto Lab</h1>
            <p>Scanner live 21 coin · chỉ tín hiệu 4h đã kiểm chứng (BOS, hai đỉnh / hai đáy)</p>
          </div>
        </div>
      </header>
      <LiveScanner />
      <Knowledge />
      <footer className="foot">Thống kê từ dữ liệu quá khứ, không đảm bảo kết quả tương lai. Trang không đặt lệnh.</footer>
    </main>
  );
}
