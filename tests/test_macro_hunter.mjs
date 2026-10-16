const { extractMacroZones, detectMacroHunterSignal } = await import("../lib/macro-hunter.ts");

function makeCandle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v, closed: true };
}

console.log("=== BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG BỘ NÃO SĂN THANH KHOẢN (MACRO HUNTER) ===");

// 1. Giả lập kịch bản ARB ngày 11/10 đến 16/10:
// - Ngày 11/10 (bar 0): Tạo đỉnh mạnh tại 0.2030 (Swing High 7D)
// - Sau đó rớt sâu xuống 0.1690
// - Ngày 16/10: ARB hồi phục lên lại vùng cản cũ 0.1985 - 0.1991
const bars4h = [];
const startTs = Date.now() - 14 * 24 * 3600 * 1000;
const H4 = 4 * 3600 * 1000;

// Nến đỉnh ngày 11/10
bars4h.push(makeCandle(startTs, 0.1920, 0.2030, 0.1910, 0.1970, 50000));
// Sau đó rơi xuống đáy
for (let i = 1; i <= 20; i++) {
  bars4h.push(makeCandle(startTs + i * H4, 0.1950 - i * 0.001, 0.1960 - i * 0.001, 0.1700, 0.1720, 10000));
}

const zones = extractMacroZones(bars4h, 0.1970);
console.log("\n[Test 1] Trích xuất Vùng Cản Macro 4H:");
console.log("- Số lượng zones tìm thấy:", zones.length);
const swingHighZone = zones.find(z => z.type === "SWING_HIGH_7D");
console.log("- Đỉnh 7D Swing High:", swingHighZone?.top, "đến", swingHighZone?.bottom, "| Status:", swingHighZone?.status, "| TouchCount:", swingHighZone?.touchCount);

if (!swingHighZone || swingHighZone.top !== 0.2030) {
  throw new Error("LỖI: Không trích xuất được đỉnh ngày 11/10!");
}

// 2. Giả lập Nến 15m lúc 14:20 của ARB:
// - Nến thò râu lên 0.1991 (thò vào vùng râu xả của đỉnh cũ)
// - Bị bán dội ngược rút râu dài (High 0.1991, Open 0.1988, Close 0.1975, Low 0.1971)
// - Volume bùng nổ 2.5x
const bars15m = [];
const M15 = 15 * 60 * 1000;
for (let i = 0; i < 25; i++) {
  bars15m.push(makeCandle(Date.now() - (25 - i) * M15, 0.1950, 0.1960, 0.1945, 0.1955, 1000));
}
// Nến trước
bars15m.push(makeCandle(Date.now() - 2 * M15, 0.1955, 0.1985, 0.1955, 0.1980, 2000));
// Nến hiện tại: Shooting star rút râu tại cản
bars15m.push(makeCandle(Date.now() - M15, 0.1980, 0.1991, 0.1971, 0.1974, 3500));

const bars1h = [makeCandle(Date.now() - 3600000, 0.1950, 0.1980, 0.1940, 0.1970, 5000)];

const hunterSignal = detectMacroHunterSignal("ARB", bars15m, bars4h, bars1h, {
  allowShort: true,
  allowLong: true,
  isBtcStrongPump: false,
});

console.log("\n[Test 2] Kết quả Bắt Tín hiệu Hunter trên ARB:");
if (hunterSignal) {
  console.log("✅ ĐÃ BẮT TRÚNG SETUP:", hunterSignal.kind);
  console.log("- Side:", hunterSignal.side === -1 ? "🔴 SHORT" : "🟢 LONG");
  console.log("- Entry:", hunterSignal.entry);
  console.log("- Stop Loss (có ATR buffer):", hunterSignal.stop);
  console.log("- Take Profit 1:", hunterSignal.tp1);
  console.log("- Take Profit 2:", hunterSignal.tp);
  console.log("- R:R:", hunterSignal.rrRatio);
  console.log("- Ghi chú:", hunterSignal.note);
  console.log("- Cờ Bypass RS:", hunterSignal.isMacroReversal);
} else {
  console.log("❌ KHÔNG BẮT ĐƯỢC TÍN HIỆU");
  throw new Error("LỖI: Bot không bắt được cú Rejection Short tại cản!");
}

// 3. Test Chặn khi BTC đang Strong Pump:
const hunterBlockedByBtc = detectMacroHunterSignal("ARB", bars15m, bars4h, bars1h, {
  allowShort: true,
  allowLong: true,
  isBtcStrongPump: true, // BTC đang dựng cột xanh
});
console.log("\n[Test 3] Kiểm tra Khóa an toàn BTC Pump Gate:");
if (!hunterBlockedByBtc) {
  console.log("✅ THÀNH CÔNG: Bot đã chặn Short khi BTC đang Strong Pump!");
} else {
  throw new Error("LỖI: Bot không chặn Short khi BTC đang Pump!");
}

console.log("\n=== TẤT CẢ CÁC BÀI TEST ĐÃ VƯỢT QUA 100% XUẤT SẮC! ===");
