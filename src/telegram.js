/**
 * TELEGRAM.JS
 * Module định dạng và phát thông báo Telegram thời gian thực.
 * Hỗ trợ chế độ Fallback in log trực quan ra Console khi chưa có Token.
 */

import dotenv from 'dotenv';
import { BOT_CONFIG } from './config.js';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Định dạng giá hiển thị chuẩn, tránh lỗi tràn số thập phân float (e.g. 87.72089426882395)
 * @param {number|string} price
 * @returns {string}
 */
export function formatPrice(price) {
  if (price === null || price === undefined || price === '') return 'N/A';
  const num = Number(price);
  if (!Number.isFinite(num)) return String(price);
  if (Math.abs(num) >= 1000) {
    return Number(num.toFixed(2)).toLocaleString('en-US');
  }
  if (Math.abs(num) >= 10) {
    return Number(num.toFixed(3)).toString();
  }
  if (Math.abs(num) >= 1) {
    return Number(num.toFixed(4)).toString();
  }
  return Number(num.toFixed(6)).toString();
}

/**
 * Loại bỏ triệt để các dấu sao ** thừa do markdown sinh ra, giúp hiển thị sạch đẹp trên mọi nền tảng
 * @param {string} str 
 * @returns {string}
 */
export function stripMarkdownAsterisks(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\*{2,3}([^*]+)\*{2,3}/g, '$1') // **từ** -> từ
    .replace(/\*{1,2}/g, ''); // Dọn sạch các dấu * thừa lẻ loi
}

/**
 * Gửi tin nhắn thô qua Telegram Bot API
 * @param {string} text - Nội dung tin nhắn (hỗ trợ HTML)
 * @returns {Promise<boolean>}
 */
/** Chạy thử (--single-run/--dry-run hoặc TELEGRAM_DRY_RUN=1) tuyệt đối không gửi tin thật. */
export const isDryRun = () => process.argv.includes('--single-run') || process.argv.includes('--dry-run') || process.env.TELEGRAM_DRY_RUN === '1';

/** Gộp cảnh báo biên hộp của nhiều coin thành một tin (thay vì mỗi coin một tin). */
export function buildBoxDigestMessage(items) {
  const f = (n) => Number(n) >= 1000 ? Number(n).toFixed(1) : Number(n).toFixed(2);
  const lines = items.map(({ symbol, alert: a }) => `• <b>${symbol}</b> ${f(a.price)} | sàn ${f(a.rangeLow)} | giữa ${f(a.equilibrium)} | trần ${f(a.rangeHigh)} → sát ${a.zone === 'LOW' ? 'SÀN (canh Long)' : 'TRẦN (canh Short)'}`);
  return `📦 <b>Hộp vĩ mô: ${items.length} coin sát biên</b>
${lines.join('\n')}
Kịch bản: chờ quét thủng biên rồi đóng cửa thụt lại; đóng nến ngoài biên thì bỏ.
<i>Chỉ cảnh báo quan sát — bot KHÔNG tự vào lệnh.</i>`;
}

export async function sendTelegramMessage(text) {
  const cleanedText = stripMarkdownAsterisks(text);

  if (isDryRun()) {
    console.log('\n[DRY-RUN: KHÔNG gửi Telegram] ----------------------');
    console.log(cleanedText.replace(/<[^>]*>?/gm, ''));
    console.log('----------------------------------------------------\n');
    return false;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('\n[TELEGRAM CONSOLE LOG] -----------------------------');
    console.log(cleanedText.replace(/<[^>]*>?/gm, '')); // Strip HTML tags
    console.log('----------------------------------------------------\n');
    return false;
  }

  // Telegram giới hạn 4096 ký tự mỗi tin nhắn -> Tự động cắt nếu vượt quá 3900 ký tự
  const MAX_LEN = 3900;
  if (cleanedText.length > MAX_LEN) {
    const parts = [];
    let currentPart = '';
    const lines = cleanedText.split('\n');

    for (const line of lines) {
      if ((currentPart + '\n' + line).length > MAX_LEN) {
        if (currentPart.trim()) parts.push(currentPart.trim());
        currentPart = line;
      } else {
        currentPart = currentPart ? (currentPart + '\n' + line) : line;
      }
    }
    if (currentPart.trim()) parts.push(currentPart.trim());

    let allOk = true;
    for (const part of parts) {
      const ok = await sendSingleTelegramChunk(part);
      if (!ok) allOk = false;
      await new Promise(r => setTimeout(r, 600)); // Nghỉ 600ms giữa các chunk để chống rate-limit
    }
    return allOk;
  }

  return await sendSingleTelegramChunk(cleanedText);
}

async function sendSingleTelegramChunk(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('[TELEGRAM] Gửi HTML lỗi:', data.description, '- Tự động gửi lại dạng Plain Text chuẩn...');
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: text.replace(/<[^>]*>?/gm, ''), // Loại bỏ các thẻ HTML bị lỗi hoặc thiếu đóng mở
          disable_web_page_preview: true
        })
      });
      const fallbackData = await fallbackRes.json();
      return fallbackData.ok;
    }
    return data.ok;
  } catch (err) {
    console.error('Lỗi gửi Telegram:', err.message);
    return false;
  }
}

/**
 * Thông báo khi phát hiện Tín hiệu vào lệnh mới (Gọn gàng, loại bỏ RR & Quản trị vốn)
 * @param {object} signal
 */
/** Bối cảnh lớn + link biểu đồ (chỉ in khi có dữ liệu). */
const contextLines = (s) => `${s.volumeNote ? `
📊 Khối lượng M15: ${s.volumeNote}` : ''}${s.macroSummary ? `
🌍 ${s.macroSummary}` : ''}${s.viewerUrl ? `
📈 <a href="${s.viewerUrl}">Xem biểu đồ & kịch bản</a>` : ''}`;

export function buildNewSignalMessage(signal) {
  const isLong = signal.direction === 'LONG';
  const icon = isLong ? '🟢' : '🔴';
  const dirText = isLong ? 'MUA (LONG)' : 'BÁN (SHORT)';
  const fmtTime = (t) => new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const triggerTime = signal.triggerTime || Date.now();
  const entryTime = signal.entryTime || triggerTime;
  const delayMin = Math.max(0, Math.round((entryTime - triggerTime) / 60000));
  const slPct = (Math.abs(signal.entry - signal.stopLoss) / signal.entry * 100).toFixed(1);
  const lev = BOT_CONFIG.leverage;

  // Chỉ nêu điểm và ngưỡng vào lệnh; KHÔNG ghi winrate/PF vì backtest 1 năm chưa chứng minh.
  const scoreInfo = signal.qualityScore ? `
⚡ <b>Điểm setup:</b> <code>${signal.qualityScore}/100</code> (ngưỡng vào lệnh ${BOT_CONFIG.minSetupQualityScore})` : '';
  const reasonInfo = signal.qualityReasons && signal.qualityReasons.length > 0 ? `
⭐ <b>Hội tụ:</b> ${signal.qualityReasons.join(' | ')}` : '';
  const rrInfo = signal.riskReward ? `
⚖️ <b>RR thực tế:</b> <code>RR ${signal.riskReward}</code> (tính tại giá vào, sau khi chờ xác nhận)` : '';
  const sizeInfo = signal.sizing ? `
🧮 <b>Size:</b> <code>${signal.sizing.size.toFixed(4)}</code> | Ký quỹ: <code>$${signal.sizing.margin.toFixed(2)}</code> (đòn bẩy ${lev}x)` : '';
  const delayInfo = delayMin > 0
    ? `
⏱️ <b>Tín hiệu:</b> ${fmtTime(triggerTime)}
⏰ <b>Vào lệnh:</b> ${fmtTime(entryTime)} (trễ ${delayMin} phút chờ xác nhận)`
    : `
⏰ <b>Thời gian:</b> ${fmtTime(entryTime)}`;

  return `
🧪 <b>[PAPER TRADE MÔ PHỎNG]</b>
${icon} <b>${dirText} ${lev}X: ${signal.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
💵 <b>Giá vào (giá đóng nến M15 sau xác nhận, KHÔNG phải lệnh Limit):</b> <code>${formatPrice(signal.entry)}</code>
🛑 <b>SL:</b> <code>${formatPrice(signal.stopLoss)}</code> (cách ${slPct}%)
🎯 <b>TP:</b> <code>${formatPrice(signal.takeProfit)}</code>${rrInfo}${sizeInfo}${scoreInfo}${reasonInfo}
📝 <b>Lý do:</b> ${signal.reason}${contextLines(signal)}${delayInfo}
⚠️ Giá hiện tại có thể đã khác giá vào — kiểm tra lại trước khi đặt lệnh tay.
🛡️ <b>Quản trị vốn:</b> Giả lập rủi ro 1R = $${BOT_CONFIG.riskUsd} (Không mất tiền thật)
`.trim();
}

/**
 * Tin báo SỚM: gửi ngay lúc phát hiện tín hiệu, TRƯỚC khi bot vào lệnh.
 * Bot vẫn quan sát thêm `delayMin` phút rồi mới tự vào lệnh giả lập; người đọc không bị chậm.
 */
export function buildEarlySignalMessage(signal, delayMin) {
  const isLong = signal.direction === 'LONG';
  const icon = isLong ? '🟢' : '🔴';
  const slPct = (Math.abs(signal.entry - signal.stopLoss) / signal.entry * 100).toFixed(1);
  const score = signal.qualityScore ? `
⚡ <b>Điểm setup:</b> <code>${signal.qualityScore}/100</code> (ngưỡng ${BOT_CONFIG.minSetupQualityScore})` : '';
  return `
⏳ <b>BÁO SỚM — CHƯA vào lệnh</b>
${icon} <b>${isLong ? 'LONG' : 'SHORT'} ${signal.symbol}</b> (${signal.strategy || 'setup'})
━━━━━━━━━━━━━━━━━━━━
📍 <b>Giá tham chiếu lúc phát hiện:</b> <code>${formatPrice(signal.entry)}</code>
🛑 <b>SL:</b> <code>${formatPrice(signal.stopLoss)}</code> (cách ${slPct}%)
🎯 <b>TP:</b> <code>${formatPrice(signal.takeProfit)}</code>${signal.riskReward ? ` | RR ${signal.riskReward}` : ''}${score}
📝 ${signal.reason}${contextLines(signal)}
👀 Bot quan sát thêm <b>${delayMin} phút</b> rồi mới tự vào lệnh giả lập. Sẽ báo HỦY nếu SL/TP bị chạm trước hoặc RR giảm dưới 1.
⚠️ Chỉ là cảnh báo sớm để bạn tự theo dõi, không phải lệnh đã khớp.
`.trim();
}

/** Cảnh báo SMC FVG (video): chỉ để bạn tự đặt lệnh Limit, bot KHÔNG tự vào lệnh. */
export function buildSmcFvgAlertMessage(symbol, sig) {
  const isLong = sig.direction === 'LONG';
  const slPct = (Math.abs(sig.entry - sig.stopLoss) / sig.entry * 100).toFixed(2);
  return `
📐 <b>SMC ${isLong ? 'MUA' : 'BÁN'} — ${symbol}</b> (BOS + FVG + quét thanh khoản, M15)
━━━━━━━━━━━━━━━━━━━━
💵 <b>Đặt lệnh LIMIT ${isLong ? 'BUY' : 'SELL'}:</b> <code>${formatPrice(sig.entry)}</code> (mép ${isLong ? 'trên' : 'dưới'} FVG ${formatPrice(sig.fvg.bot)} - ${formatPrice(sig.fvg.top)})
🛑 <b>SL:</b> <code>${formatPrice(sig.stopLoss)}</code> (cách ${slPct}%, ngoài mép kia của FVG)
🎯 <b>TP:</b> <code>${formatPrice(sig.takeProfit)}</code> (RR 1:${sig.rr})
📊 Backtest M15 2020–26 (SL ≥0.8%): PF 1.21 chưa trừ phí, ~1.07 sau phí Maker; tỷ lệ thắng ~29%, ăn lớn khi thắng.
⚠️ Chỉ cảnh báo — bot KHÔNG tự vào lệnh. Hủy nếu giá đóng cửa xuyên thủng FVG.
`.trim();
}

export function buildPendingCancelMessage(signal, reason) {
  return `
❌ <b>HỦY tín hiệu ${signal.direction} ${signal.symbol}</b>
Lý do: ${reason}
Bot không vào lệnh này — nếu bạn đã chuẩn bị vào tay thì đừng vào.
`.trim();
}

async function safeSend(msg) {
  try { await sendTelegramMessage(msg); } catch (e) { console.error('[TELEGRAM] Gửi tin thất bại:', e.message); }
}
export const notifyEarlySignal = (signal, delayMin) => safeSend(buildEarlySignalMessage(signal, delayMin));
export const notifyPendingCancelled = (signal, reason) => safeSend(buildPendingCancelMessage(signal, reason));

export async function notifyNewSignal(signal) {
  await sendTelegramMessage(buildNewSignalMessage(signal));
}

/**
 * Thông báo khi vị thế kích hoạt dời SL bảo vệ vốn hoặc khóa lợi nhuận
 * @param {object} position
 * @param {number} newSL
 */
export async function notifyBreakevenTriggered(position, newSL) {
  const isProfitLock = position.isProfitLocked;
  const title = isProfitLock
    ? '🔒 <b>KÍCH HOẠT KHÓA LỢI NHUẬN (DỜI SL DƯƠNG)</b>'
    : '🛡️ <b>KÍCH HOẠT CO SL GIẢM THIỂU RỦI RO</b>';
  const actionText = isProfitLock
    ? `Đã kéo Stop Loss lên <b>+1.0R</b> (<code>${formatPrice(newSL)}</code>) để khóa chắc lợi nhuận!`
    : `Đã co Stop Loss về <b>-0.3R</b> (<code>${formatPrice(newSL)}</code>) để cắt giảm 70% rủi ro!`;

  const msg = `
🧪 <b>[PAPER TRADE]</b> ${title}: <b>${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📈 Giá đang di chuyển thuận lợi theo đúng kịch bản!
🔒 <b>Hành động:</b> ${actionText}
💎 <b>Mục tiêu TP:</b> <code>${formatPrice(position.takeProfit)}</code> (Tiếp tục gồng lệnh).
✨ Vị thế được bảo vệ rủi ro tối đa!
`.trim();

  await sendTelegramMessage(msg);
}

/**
 * Thông báo Chốt Lời Toàn Bộ (Take Profit 100%)
 * @param {object} position
 * @param {number} exitPrice
 * @param {number} pnlR
 * @param {number} netPnlUsd
 */
export async function notifyTakeProfit(position, exitPrice, pnlR, netPnlUsd) {
  const msg = `
🧪 <b>[PAPER TRADE]</b> 🎯 <b>CHỐT LỜI THÀNH CÔNG (TP HIT): ${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
🚀 <b>Đóng 100% vị thế tại TP:</b> <code>${formatPrice(exitPrice)}</code>
💰 <b>Lợi nhuận đạt:</b> <b>+${pnlR.toFixed(2)}R</b>
💵 <b>Thực nhận (Mô phỏng):</b> <b>+$${netPnlUsd.toFixed(2)} USDT</b>
⏰ <b>Thời gian đóng:</b> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
`.trim();

  await sendTelegramMessage(msg);
}

/**
 * Thông báo Dừng Lỗ hoặc Chốt Lời Khóa Lợi Nhuận
 * @param {object} position
 * @param {number} exitPrice
 * @param {number} pnlR
 * @param {number} netPnlUsd
 * @param {boolean} isBE
 */
export async function notifyStopLoss(position, exitPrice, pnlR, netPnlUsd, isBE = false) {
  const title = isBE
    ? (pnlR > 0.5 ? '🎯 CHỐT LỜI KHÓA LỢI NHUẬN (+1.0R HIT)' : '🛡️ THOÁT VỊ THẾ HÒA VỐN (BE HIT)')
    : '🛑 CẮT LỖ (STOP LOSS HIT)';
  const msg = `
🧪 <b>[PAPER TRADE]</b> ${title}: <b>${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📉 <b>Giá khớp thoát:</b> <code>${formatPrice(exitPrice)}</code>
📊 <b>Kết quả PnL:</b> ${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(2)}R ($${netPnlUsd.toFixed(2)} USDT)
📌 Kỷ luật 1R bảo vệ an toàn tối đa cho tài khoản!
`.trim();

  await sendTelegramMessage(msg);
}

/**
 * Thông báo Bản Kiểm Điểm Thất Bại & Hình Phạt Kỷ Luật Sau Stop Loss
 * @param {object} position
 * @param {object} mistake
 * @param {object} penalty
 */
export async function notifyPostMortemPenalty(position, mistake, penalty) {
  const msg = `
🚨 <b>BẢN KIỂM ĐIỂM THẤT BẠI & HÌNH PHẠT BOT</b>
━━━━━━━━━━━━━━━━━━━━
📌 <b>Cặp giao dịch:</b> <b>${position.symbol}</b> (${position.direction})
📉 <b>Stop Loss tại:</b> <code>${formatPrice(position.stopLoss)}</code>
🛑 <b>Lỗ:</b> <b>-1.0R (-$10.00 USDT)</b>

🔍 <b>MỔ XẺ ĐIỂM SAI CỦA BOT:</b>
• <b>Giai đoạn nến H4:</b> <code>${mistake.marketPhase}</code>
• <b>Lỗi vi phạm:</b> <b>${mistake.mistakeTitle}</b>
• <b>Chi tiết:</b> ${mistake.rootCause}

⚖️ <b>HÌNH PHẠT CẤU TRÚC ĐẦU TÀU (KHÔNG DÙNG ĐỒNG HỒ):</b>
• 🚂 <b>Điều kiện gỡ phạt:</b> Bắt buộc Đầu Tàu BTC phải xác nhận cấu trúc <code>${mistake.requiredBtcConfirmation || 'Đảo chiều nến H1/H4'}</code>!
• 🚫 <b>Cấm vào lệnh:</b> ${mistake.forbiddenDirection ? `CẤM ${mistake.forbiddenDirection}` : 'Tạm ngưng toàn bộ'}
• 📉 <b>Kỷ luật vốn:</b> ${penalty.riskAction}
• ⚠️ <b>Chuỗi thua liên tiếp:</b> ${penalty.consecutiveLosses} lệnh
━━━━━━━━━━━━━━━━━━━━
💡 <i>Bot đã ghi nhớ bài học vào trade_memory.json để không bao giờ tái phạm!</i>
`.trim();

  await sendTelegramMessage(msg);
}

/**
 * Thông báo Time-Stop (Đóng lệnh sau 16 nến M15 lình xình)
 * @param {object} position
 * @param {number} exitPrice
 * @param {number} netPnlUsd
 */
export async function notifyTimeStop(position, exitPrice, netPnlUsd) {
  const msg = `
⏱️ <b>KÍCH HOẠT TIME-STOP (16 NẾN M15 / 4 TIẾNG): ${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
⚠️ Sau 4 giờ dao động đi ngang trong biên độ hẹp, hệ thống chủ động đóng lệnh tại <code>${formatPrice(exitPrice)}</code>.
💵 <b>PnL ròng:</b> $${netPnlUsd.toFixed(2)} USDT
🔄 Thu hồi vốn để dồn cho các cơ hội cấu trúc sắc nét hơn!
`.trim();

  await sendTelegramMessage(msg);
}

