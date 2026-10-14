import assert from "node:assert/strict";
const { scoreSide, pickCoin } = await import("../lib/overview.ts");
const H1 = 3_600_000, H4 = 4 * H1, M15 = 900_000;
const flat = (n, step, mk) => Array.from({ length: n }, (_, i) => ({ t: i * step, v: 1, closed: true, ...mk(i) }));
// 4H/1H đi ngang quanh 100, có swing đỉnh 1H ở 103 (mục tiêu LONG)
const h4 = flat(40, H4, (i) => ({ o: 100, h: 101 + (i % 7 === 3 ? 1 : 0), l: 99 - (i % 7 === 5 ? 1 : 0), c: 100 }));
const h1 = flat(40, H1, (i) => ({ o: 100, h: i === 30 ? 105 : 100.5, l: 99.5, c: 100 }));
// 15m: rơi xuống quét đáy 98.5 rồi nến xanh mạnh volume lớn
const m15 = flat(40, M15, () => ({ o: 100, h: 100.3, l: 99.7, c: 100 }));
m15[38] = { t: 38 * M15, o: 99.8, h: 99.9, l: 98.5, c: 99.7, v: 1, closed: true };
m15[39] = { t: 39 * M15, o: 99.7, h: 100.6, l: 99.6, c: 100.5, v: 5, closed: true };
const L = scoreSide(1, { own: 1, btc: 1, h4, h1, m15 });
assert.ok(L, "có kế hoạch LONG");
assert.ok(L.score >= 3, `LONG đủ lớp: ${L.score} ${L.reasons}`);
assert.ok(L.stop < 98.5 && L.tp > L.entry && L.rr >= 1.5, JSON.stringify(L));
// ngược trend + BTC ngược → ít lớp hơn
const L2 = scoreSide(1, { own: -1, btc: -1, h4, h1, m15 });
assert.ok(L2.score < L.score);
// minScore cao quá → không chọn
assert.equal(pickCoin("X", { own: -1, btc: -1, h4, h1, m15 }, 5), null);
// SL tối thiểu 1 ATR(1H): ATR 1H fixture ≈ 1 → SL cách giá ≥ ~1
assert.ok(L.entry - L.stop >= 0.99, `SL đủ xa: ${L.entry - L.stop}`);

// Test nến 15m Pinbar rút chân râu siêu dài -> tự chuyển sang LIMIT_PULLBACK
const m15Pin = flat(40, M15, () => ({ o: 100, h: 100.3, l: 99.7, c: 100 }));
// ATR(1H) ≈ 1. range15 = 101.5 - 98.5 = 3.0 (> 0.8 * 1.0). Rút chân từ 98.5 lên 101.4 (impulse = 2.9 > 0.6 * 3.0)
m15Pin[38] = { t: 38 * M15, o: 99.8, h: 99.9, l: 99.0, c: 99.7, v: 1, closed: true };
m15Pin[39] = { t: 39 * M15, o: 99.7, h: 101.5, l: 98.5, c: 101.4, v: 6, closed: true };
const LPin = scoreSide(1, { own: 1, btc: 1, h4, h1, m15: m15Pin });
if (LPin) {
  assert.equal(LPin.orderType, "LIMIT_PULLBACK");
  assert.ok(LPin.entry < 101.4, `Entry phải lùi lại Fibo: ${LPin.entry}`);
}

// Test BTC 1H xả shock -> chặn mọi lệnh LONG
const btcShock = flat(30, H1, () => ({ o: 100, h: 100.5, l: 99.5, c: 100 }));
btcShock[29] = { o: 100, h: 100.2, l: 97.0, c: 97.2, closed: true, v: 10 }; // xả nến đỏ ~2.8 ATR
const LShock = scoreSide(1, { own: 1, btc: 1, h4, h1, m15, btcH1: btcShock });
assert.equal(LShock, null, "BTC 1H shock xả mạnh phải chặn đứng lệnh LONG");

// Order flow phải chấm theo đúng chiều đang xét: CVD gom cộng cho LONG, không cộng cho SHORT
const acc = { coin: "X", delta1h: 1, delta4hTotal: 5, isCvdAccumulating: true, isCvdDistributing: false, ratioBuySell4h: 1.3 };
const LC = scoreSide(1, { own: 1, btc: 1, h4, h1, m15, cvdData: acc });
assert.equal(LC.score, L.score + 1, "CVD gom phải +1 cho LONG");
const SC = scoreSide(-1, { own: 1, btc: 1, h4, h1, m15, cvdData: acc });
assert.ok(!SC || !SC.reasons.some((r) => r.includes("🐳")), "CVD gom không được cộng cho SHORT");

console.log("All overview tests passed!");
