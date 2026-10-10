// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse, swings } from "@/lib/patterns";
import { candles, ticker } from "@/lib/okx";
import { evaluateSetup } from "@/lib/decision-engine";
import { openPaperPlan, paperSummary, reconcilePaperPositions } from "@/lib/paper-ledger";
import { isStarSetup, calculatePartialPnL, formatEntryReason } from "@/lib/trading-policy";
import { getCapitalTier, checkTierChange } from "@/lib/capital-tier";
import { getMexcAccountAsset, submitMexcOrder, submitMexcTpSl } from "@/lib/mexc-client";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

const DEDUP_FILE = path.join(process.cwd(), "service", "telegram-sent.json");

function loadDedup(): { sent: string[]; preSent: string[] } {
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
      return { sent: data.sent ?? [], preSent: data.preSent ?? [] };
    }
  } catch {}
  return { sent: [], preSent: [] };
}

function saveDedup(sentSet: Set<string>, preSentSet: Set<string>) {
  try {
    const data = {
      sent: Array.from(sentSet).slice(-300),
      preSent: Array.from(preSentSet).slice(-300),
    };
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

const initialDedup = loadDedup();

declare global {
  var telegramSent: Set<string> | undefined;
  var telegramPreSent: Set<string> | undefined;
  var lastReportedTierEquity: number | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>(initialDedup.sent));
const preSent = (globalThis.telegramPreSent ??= new Set<string>(initialDedup.preSent));

const dailyTrendCache: Record<string, { trend: 1 | -1 | 0; ts: number }> = {};

async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const cached = dailyTrendCache[coin];
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.trend;
  try {
    const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
    if (d.length < 60) return 0;
    let ema = d[0].c;
    for (const c of d) ema += (2 / 51) * (c.c - ema);
    const tr = d.at(-1)!.c > ema ? 1 : -1;
    dailyTrendCache[coin] = { trend: tr, ts: Date.now() };
    return tr;
  } catch {
    if (cached) return cached.trend;
    return 0;
  }
}

const f = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });

export async function send(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID chưa cấu hình");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error(`Telegram ${res.status}:`, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram send error", e);
    return false;
  }
}

/** Scan the verified 4H setups. */
export async function scanAndAlert(): Promise<string[]> {
  const [btc, btc1h] = await Promise.all([
    dailyTrend("BTC"),
    candles("BTC-USDT-SWAP", "1H", 10).catch(() => []),
  ]);
  const mexcAsset = await getMexcAccountAsset(CAPITAL);
  const currentEquity = mexcAsset.equity;
  const currentTier = getCapitalTier(currentEquity);

  if (globalThis.lastReportedTierEquity !== undefined && globalThis.lastReportedTierEquity !== currentEquity) {
    const tierCheck = checkTierChange(globalThis.lastReportedTierEquity, currentEquity);
    if (tierCheck.changed) {
      if (tierCheck.direction === "up") {
        await send(
          `🚀 *[THĂNG HẠNG VỐN THÀNH CÔNG]*\n\n` +
          `• *Số dư tài khoản:* \`${currentEquity.toFixed(2)}$\` ➔ *LÊN ${tierCheck.newTier.name}*\n` +
          `• *Rủi ro mỗi lệnh mới:* \`${tierCheck.newTier.riskPerTradeUsd}$\` / lệnh\n` +
          `• *Số lệnh tối đa đồng thời:* \`${tierCheck.newTier.maxOpenTrades}\` lệnh\n` +
          `• *Mốc khóa bảo vệ lợi nhuận (Ratchet):* \`${tierCheck.newTier.ratchetFloorUsd}$\``
        );
      } else if (tierCheck.direction === "down") {
        await send(
          `🛡️ *[KÍCH HOẠT PHÒNG VỆ VỐN]*\n\n` +
          `• *Số dư tài khoản:* \`${currentEquity.toFixed(2)}$\` ➔ *HẠ VỀ ${tierCheck.newTier.name}*\n` +
          `• Tự động hạ rủi ro về \`${tierCheck.newTier.riskPerTradeUsd}$\` / lệnh để bảo toàn vốn đã tích lũy.`
        );
      }
    }
  }
  globalThis.lastReportedTierEquity = currentEquity;

  // Kiểm tra hạn API MEXC (90 ngày từ lúc tạo: 10/10/2026 -> hết hạn 08/01/2027)
  // Chỉ cảnh báo khi còn đúng <= 1 ngày
  const apiCreatedAt = new Date("2026-10-10T12:00:00+07:00").getTime();
  const apiExpiresAt = apiCreatedAt + 90 * 24 * 3600 * 1000;
  const daysLeft = (apiExpiresAt - Date.now()) / (24 * 3600 * 1000);
  if (daysLeft <= 1.0 && daysLeft > 0) {
    const keyExpire = `API_EXPIRE_ALERT_${new Date().toISOString().slice(0, 10)}`;
    if (!sent.has(keyExpire)) {
      await send(
        `⚠️ *[CẢNH BÁO: KEY API MEXC SẮP HẾT HẠN]*\n\n` +
        `• Key API của bác chỉ còn *${Math.max(0, Math.ceil(daysLeft * 24))} giờ* nữa là hết hạn 90 ngày!\n` +
        `• Bác vào MEXC: *Quản lý API ➔ Thao tác ➔ Bấm Gia hạn* để cộng thêm 90 ngày nhé!`
      );
      sent.add(keyExpire);
      saveDedup(sent, preSent);
    }
  }

  const paper = paperSummary(currentEquity);
  const itemsToSend: { key: string; msg: string }[] = [];
  const out: string[] = [];

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const [bars4h, own] = await Promise.all([
        candles(`${coin}-USDT-SWAP`, "4H", 300),
        coin === "BTC" ? btc : dailyTrend(coin)
      ]);
      reconcilePaperPositions(coin, bars4h, currentEquity);
      const a4 = analyse(bars4h);

      const tLive = await ticker(`${coin}-USDT-SWAP`).catch(() => null);

      // 1. Quét 4H
      for (const s of a4.setups) {
        if (s.state !== "triggered") continue;
        const decision = evaluateSetup(s, {
          coin,
          timeframe: "4H",
          btcDaily: btc,
          ownDaily: own,
          equity: currentEquity,
          peakEquity: paper.peakEquity,
          lastBarTime: a4.lastBarTime,
          livePrice: tLive?.last,
          btc1hBars: btc1h,
        });
        if (!decision.accepted || !decision.plan) continue;
        const plan = decision.plan;
        const risk = plan.riskPct;

        const key = `4H:${coin}:${s.style}:${s.side}:${a4.lastBarTime}`;
        if (sent.has(key)) continue;

        const sizing = plan.sizing;
        const pnl = calculatePartialPnL(sizing.actualRiskUsd);

        // Đặt lệnh MEXC (thực tế hoặc dry-run)
        const mexcOrder = await submitMexcOrder({
          symbol: coin,
          side: s.side,
          notional: sizing.notional,
          price: s.entry,
          leverage: sizing.leverage,
        });

        if (mexcOrder.success) {
          await submitMexcTpSl({
            symbol: coin,
            side: s.side,
            vol: mexcOrder.vol,
            stopLossPrice: s.stop,
            takeProfit1Price: plan.tp1,
            takeProfit2Price: plan.tp2,
          });
        }

        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const reason = formatEntryReason({
          style: s.style,
          side: s.side,
          timeframe: "4H",
          btcDaily: btc,
          ownDaily: own,
          volumeRatio: s.volumeRatio,
        });

        const autoTag = mexcOrder.isDryRun
          ? `🚀 *[VÀO LỆNH]*`
          : `🤖 *[MEXC ĐÃ VÀO LỆNH - ${mexcOrder.vol} HĐ]*`;

        itemsToSend.push({
          key,
          msg:
            `${autoTag} ${sideStr} *${coin}*\n` +
            `• *Điểm vào:* ~${f(s.entry)}\n` +
            `• *Cắt lỗ (SL):* ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            `• *Chốt lời (TP):* TP1 ${f(plan.tp1)} (+${pnl.winTp1.toFixed(2)}$) | TP2 ${f(plan.tp2)} (+${pnl.totalWin.toFixed(2)}$)\n` +
            `• *Sao vô:* ${reason}\n` +
            `• *Ký quỹ:* ~${sizing.margin}$ (x${sizing.leverage} Isolated) · *Rủi ro 1R:* ${sizing.actualRiskUsd}$`
        });
        openPaperPlan(key, decision, bars4h, currentEquity);
      }

      // 2. Quét 1H (Lướt sóng sớm)
      const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 120);
      const a1 = analyse(bars1h);
      for (const s of a1.setups) {
        if (s.state !== "triggered") continue;
        const decision1h = evaluateSetup(s, {
          coin,
          timeframe: "1H",
          btcDaily: btc,
          ownDaily: own,
          equity: currentEquity,
          peakEquity: paper.peakEquity,
          lastBarTime: a1.lastBarTime,
          livePrice: tLive?.last,
          btc1hBars: btc1h,
        });
        if (!decision1h.accepted || !decision1h.plan) continue;
        const plan1h = decision1h.plan;

        const key1h = `1H:${coin}:${s.style}:${s.side}:${a1.lastBarTime}`;
        if (sent.has(key1h)) continue;

        const sizing1h = plan1h.sizing;
        const pnl1h = calculatePartialPnL(sizing1h.actualRiskUsd);

        // Đặt lệnh MEXC (thực tế hoặc dry-run)
        const mexcOrder1h = await submitMexcOrder({
          symbol: coin,
          side: s.side,
          notional: sizing1h.notional,
          price: s.entry,
          leverage: sizing1h.leverage,
        });

        if (mexcOrder1h.success) {
          await submitMexcTpSl({
            symbol: coin,
            side: s.side,
            vol: mexcOrder1h.vol,
            stopLossPrice: s.stop,
            takeProfit1Price: plan1h.tp1,
            takeProfit2Price: plan1h.tp2,
          });
        }

        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const reason1h = formatEntryReason({
          style: s.style,
          side: s.side,
          timeframe: "1H",
          btcDaily: btc,
          ownDaily: own,
          volumeRatio: s.volumeRatio,
        });

        const autoTag1h = mexcOrder1h.isDryRun
          ? `⚡ *[LƯỚT SÓNG 1H]*`
          : `🤖 *[MEXC ĐÃ VÀO LỆNH - ${mexcOrder1h.vol} HĐ]*`;

        itemsToSend.push({
          key: key1h,
          msg:
            `${autoTag1h} ${sideStr} *${coin}*\n` +
            `• *Điểm vào:* ~${f(s.entry)}\n` +
            `• *Cắt lỗ (SL):* ${f(s.stop)} (-${(plan1h.riskPct * 100).toFixed(2)}%)\n` +
            `• *Chốt lời (TP):* TP1 ${f(plan1h.tp1)} (+${pnl1h.winTp1.toFixed(2)}$) | TP2 ${f(plan1h.tp2)} (+${pnl1h.totalWin.toFixed(2)}$)\n` +
            `• *Sao vô:* ${reason1h}\n` +
            `• *Ký quỹ:* ~${sizing1h.margin}$ (x${sizing1h.leverage} Isolated) · *Rủi ro 1R:* ${sizing1h.actualRiskUsd}$`
        });
        openPaperPlan(key1h, decision1h, bars4h, currentEquity);
      }

    } catch (e) {
      console.error(`telegram scan ${coin}`, e);
    }
  }

  // Gửi tin nhắn và CHỈ đánh dấu sent khi thành công (tránh mất tín hiệu khi mạng lỗi)
  for (const item of itemsToSend) {
    const ok = await send(item.msg);
    if (ok) {
      sent.add(item.key);
      saveDedup(sent, preSent);
      out.push(item.msg);
    }
  }
  return out;
}

const H4 = 4 * 3_600_000;
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Báo trước: ~5 phút trước khi nến đóng (chỉ báo khi coin áp sát mức kích hoạt <= 1%) */
export async function preAlert(now = Date.now(), force = false): Promise<string | null> {
  const close4h = Math.floor(now / H4) * H4 + H4;
  const left4h = close4h - now;
  // Báo trước ~5 phút (từ phút 53 đến 58)
  const is4hSlot = force || (left4h <= 7 * 60_000 && left4h >= 1 * 60_000);
  if (!is4hSlot) return null;

  const key = `4H:${close4h}`;
  if (!force && preSent.has(key)) return null;

  const btc = await dailyTrend("BTC");
  const lines4h: string[] = [];
  const paper = paperSummary(CAPITAL);

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const own = coin === "BTC" ? btc : await dailyTrend(coin);

      // 1. Quét 4h nếu đang ở slot 4h (khoảng cách <= 1.5%)
      if (is4hSlot) {
        const a4 = analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300));
        for (const s of a4.setups) {
          if (s.state !== "pending") continue;
          const decision = evaluateSetup(s, { coin, timeframe: "4H", btcDaily: btc, ownDaily: own, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a4.lastBarTime, now });
          if (decision.code !== "PENDING_CONFIRMATION" || Math.abs(s.distancePct) > 0.015) continue;
          const risk = Math.abs(s.entry - s.stop) / s.entry;
          const isStar = isStarSetup(s.side, own, btc);
          const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
          const styleStr = s.style === "bos" ? "BOS 4H" : (s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H");

          lines4h.push(
            `• ${coin} ${sideStr} (${styleStr})${isStar ? " ⭐ [KÈO ĐẸP ★★★]" : ""}: ` +
            `cần đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (-${(risk * 100).toFixed(1)}%)`
          );
        }
      }

    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }

  // Nếu KHÔNG có coin nào (cả 4h lẫn 1h) sắp kích hoạt: TUYỆT ĐỐI IM LẶNG, không gửi tin rác
  if (!lines4h.length) {
    return null;
  }

  const msg = `⏰ Nến 4h đóng lúc ${vnTime(close4h)} (còn ~${Math.round(left4h / 60_000)} phút)\n` +
    `📌 Setup PAPER sắp xác nhận:\n${lines4h.join("\n")}\n\n💡 Chỉ theo dõi; decision engine sẽ đánh giá lại sau khi nến đóng.`;

  const ok = await send(msg);
  if (ok) {
    preSent.add(key);
    saveDedup(sent, preSent);
    return msg;
  }
  return null;
}

const radarSent = new Map<string, number>();

/**
 * Radar tự động: quét liên tục mỗi 5 phút, báo động khi coin lọt vào vùng tiệm cận <= 1.0% Đỉnh cũ / Đáy cũ
 */
export async function proximityRadarAlert(): Promise<string | null> {
  const alerts: string[] = [];
  const now = Date.now();

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 50));
      const [c4, tLive] = await Promise.all([
        candles(`${coin}-USDT-SWAP`, "4H", 60),
        ticker(`${coin}-USDT-SWAP`).catch(() => null),
      ]);
      const { highs, lows } = swings(c4);
      if (!highs.length || !lows.length || !tLive) continue;

      const lastHigh = c4[highs.at(-1)!].h;
      const lastLow = c4[lows.at(-1)!].l;
      const livePrice = tLive.last;

      const distHigh = (lastHigh - livePrice) / livePrice;
      const distLow = (livePrice - lastLow) / livePrice;

      // 1. Áp sát Đỉnh cũ (cách <= 1.0% hoặc vừa nhú qua <= 0.3%)
      if (distHigh >= -0.003 && distHigh <= 0.010) {
        const key = `RADAR:HIGH:${coin}:${lastHigh}`;
        const lastSent = radarSent.get(key) ?? 0;
        if (now - lastSent > 2 * 3_600_000) {
          radarSent.set(key, now);
          const pct = (Math.abs(distHigh) * 100).toFixed(2);
          alerts.push(
            `🏔️ *${coin}* đang ở \`${f(livePrice)}\` ➔ Sát ĐỈNH CŨ \`${f(lastHigh)}\` (cách *${pct}%*)!\n` +
            `👉 *Mở chart canh:* Rút râu xả (Pinbar) ➔ Canh SHORT; Nến 1H đóng vượt ➔ Canh LONG.`
          );
        }
      }

      // 2. Áp sát Đáy cũ (cách <= 1.0% hoặc vừa nhúng qua <= 0.3%)
      if (distLow >= -0.003 && distLow <= 0.010) {
        const key = `RADAR:LOW:${coin}:${lastLow}`;
        const lastSent = radarSent.get(key) ?? 0;
        if (now - lastSent > 2 * 3_600_000) {
          radarSent.set(key, now);
          const pct = (Math.abs(distLow) * 100).toFixed(2);
          alerts.push(
            `🏖️ *${coin}* đang ở \`${f(livePrice)}\` ➔ Sát ĐÁY CŨ \`${f(lastLow)}\` (cách *${pct}%*)!\n` +
            `👉 *Mở chart canh:* Rút chân pinbar ➔ Canh LONG bắt đáy; Nến đóng thủng ➔ Canh SHORT.`
          );
        }
      }
    } catch {}
  }

  if (!alerts.length) return null;

  const msg = `🧭 *[RADAR TỰ ĐỘNG: TIỆM CẬN ĐỈNH / ĐÁY]*\n\n${alerts.join("\n\n")}\n\n💡 Nhắn tên coin (ví dụ: \`${COINS[0]}\`) để xem thông số SL/TP!`;
  await send(msg);
  return msg;
}

