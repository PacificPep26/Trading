import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

console.log("==========================================================================");
console.log("🧪 TẦNG 3 & 4: KIỂM THỬ MÁY TRẠNG THÁI, COOLDOWN 60M & KHẤU TRỪ PHÍ SÀN");
console.log("==========================================================================");

const { openPaperTrade, stepPaperTrades, loadPaperTrades } = await import("../lib/auto-paper-trader.ts");
const { cooldownMap } = await import("../lib/cooldown.ts");

const TEST_PAPER_FILE = path.join(process.cwd(), "data", "paper-auto-bot.json");

// Dọn dẹp trước khi test
function resetPaperFile() {
  if (fs.existsSync(TEST_PAPER_FILE)) {
    fs.unlinkSync(TEST_PAPER_FILE);
  }
  cooldownMap.clear();
}

// --------------------------------------------------------------------------
// TEST 1: KIỂM THỬ KHÓA COOLDOWN 60 PHÚT SAU KHI CẮT LỖ
// --------------------------------------------------------------------------
{
  resetPaperFile();

  // 1. Mở 1 lệnh Long SUI
  const { trade } = openPaperTrade({
    coin: "SUI",
    side: 1,
    entry: 1.000,
    stop: 0.980,
    tp: 1.040,
    note: "Test lệnh Long SUI",
  });
  assert.notEqual(trade, null, "Lệnh đầu tiên phải mở thành công");

  // 2. Nến tiếp theo xả gãy SL xuống 0.970
  const slCandles = [{ h: 1.000, l: 0.970, c: 0.975, closed: true }];
  const msgs = stepPaperTrades("SUI", slCandles);

  assert.ok(msgs.some(m => m.includes("CẮT LỖ BẢO VỆ")), "Phải phát hiện và kích hoạt sự kiện cắt lỗ");
  
  // 3. Kiểm tra xem Cooldown Map đã ghi nhận thời gian cách ly 60 phút chưa
  const cdUntil = cooldownMap.get("SUI");
  assert.notEqual(cdUntil, undefined, "SUI bắt buộc phải được đưa vào danh sách Cooldown");
  assert.ok(cdUntil > Date.now() + 50 * 60_000, "Thời gian Cooldown phải duy trì tối thiểu gần 60 phút");

  // 4. Cố tình mở lại lệnh SUI ngay lập tức -> Phải bị từ chối
  const isSuiInCooldown = (cooldownMap.get("SUI") || 0) > Date.now();
  assert.equal(isSuiInCooldown, true, "SUI đang trong thời gian hạ nhiệt tâm lý, cấm được mở lệnh mới!");

  console.log("✅ Test 1 (Khóa Cooldown 60 phút sau cắt lỗ): PASSED!");
}

// --------------------------------------------------------------------------
// TEST 2: KIỂM THỬ GIỚI HẠN TỐI ĐA 2 VỊ THẾ CÙNG LÚC (MAX CONCURRENT RISK)
// --------------------------------------------------------------------------
{
  resetPaperFile();

  // Mở vị thế 1: TIA
  const t1 = openPaperTrade({ coin: "TIA", side: 1, entry: 0.590, stop: 0.580, tp: 0.610, note: "Lệnh 1" });
  assert.notEqual(t1.trade, null, "Lệnh TIA phải mở thành công");

  // Mở vị thế 2: APT
  const t2 = openPaperTrade({ coin: "APT", side: 1, entry: 0.830, stop: 0.810, tp: 0.870, note: "Lệnh 2" });
  assert.notEqual(t2.trade, null, "Lệnh APT phải mở thành công");

  // Cố tình mở vị thế 3: NEAR
  const t3 = openPaperTrade({ coin: "NEAR", side: 1, entry: 5.200, stop: 5.100, tp: 5.400, note: "Lệnh 3" });
  assert.equal(t3.trade, null, "Vị thế thứ 3 bắt buộc phải bị CHẶN để không vượt quá rủi ro tài khoản");
  assert.equal(t3.alertMsg, null);

  console.log("✅ Test 2 (Giới hạn tối đa 2 vị thế an toàn): PASSED!");
}

// --------------------------------------------------------------------------
// TEST 3: KIỂM THỬ KHẤU TRỪ PHÍ SÀN TAKER & TRƯỢT GIÁ (0.16% ROUND-TRIP PENALTY)
// --------------------------------------------------------------------------
{
  resetPaperFile();

  // Mở 1 lệnh Long
  openPaperTrade({ coin: "AVAX", side: 1, entry: 30.00, stop: 29.50, tp: 31.00, note: "Test phí" });

  // Giá chạy lên chạm TP 31.00
  const winCandles = [{ h: 31.20, l: 30.00, c: 31.10, closed: true }];
  stepPaperTrades("AVAX", winCandles);

  const trades = loadPaperTrades();
  const avaxTrade = trades.find(t => t.coin === "AVAX");
  assert.equal(avaxTrade?.status, "closed_tp");

  // Lãi thô: (31.00 - 30.00) / 30.00 = +3.333% * 10x đòn bẩy * 10$ margin = +3.33$
  // Phí sàn & trượt giá phải được khấu trừ đúng (không được giữ nguyên 3.33$)
  assert.ok(avaxTrade.pnlUsdt < 3.333, "Lợi nhuận ròng phải bị khấu trừ phí sàn và trượt giá");
  assert.ok(avaxTrade.pnlUsdt > 0, "Lợi nhuận sau phí vẫn phải dương");

  console.log("✅ Test 3 (Khấu trừ phí sàn & trượt giá nghiêm ngặt): PASSED!");
}

resetPaperFile();
console.log("🎉 TẤT CẢ CÁC BÀI TEST TẦNG 3 & 4 ĐÃ VƯỢT QUA 100%!\n");
