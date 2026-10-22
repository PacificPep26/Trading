/**
 * TELEGRAM.JS
 * Module định dạng và phát thông báo Telegram thời gian thực.
 * Hỗ trợ chế độ Fallback in log trực quan ra Console khi chưa có Token.
 */

import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Gửi tin nhắn thô qua Telegram Bot API
 * @param {string} text - Nội dung tin nhắn (hỗ trợ HTML)
 * @returns {Promise<boolean>}
 */
export async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('\n[TELEGRAM CONSOLE LOG] -----------------------------');
    console.log(text.replace(/<[^>]*>?/gm, '')); // Strip HTML tags
    console.log('----------------------------------------------------\n');
    return false;
  }

  // Telegram giới hạn 4096 ký tự mỗi tin nhắn -> Tự động cắt nếu vượt quá 3900 ký tự
  const MAX_LEN = 3900;
  if (text.length > MAX_LEN) {
    const parts = [];
    let currentPart = '';
    const lines = text.split('\n');

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

  return await sendSingleTelegramChunk(text);
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
export async function notifyNewSignal(signal) {
  const isLong = signal.direction === 'LONG';
  const icon = isLong ? '🟢' : '🔴';
  const dirText = isLong ? 'MUA (LONG)' : 'BÁN (SHORT)';

  const msg = `
${icon} <b>${dirText} 10X: ${signal.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
💵 <b>Entry:</b> <code>${signal.entry}</code>
🛑 <b>SL:</b> <code>${signal.stopLoss}</code>
🎯 <b>TP:</b> <code>${signal.takeProfit}</code>
📝 <b>Lý do:</b> ${signal.reason}
⏰ <b>Thời gian:</b> ${new Date(signal.triggerTime || Date.now()).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
`.trim();

  await sendTelegramMessage(msg);
}

/**
 * Thông báo khi vị thế đạt +1.5R và tự động Kéo SL lên khóa +1.0R
 * @param {object} position
 * @param {number} newSL
 */
export async function notifyBreakevenTriggered(position, newSL) {
  const msg = `
🔒 <b>KÍCH HOẠT KHÓA LỢI NHUẬN (+1.5R ➔ SL +1.0R): ${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📈 Lợi nhuận tạm tính đã chạm mốc <b>+1.5R</b>!
🔒 <b>Hành động:</b> Đã kéo Stop Loss lên mức <b>DƯƠNG +1.0R</b> (<code>${newSL}</code>) để khóa chắc 1R lợi nhuận!
💎 <b>Trạng thái:</b> <b>GIỮ NGUYÊN 100% VỊ THẾ</b> để gồng tiếp tới Take Profit: <code>${position.takeProfit}</code>.
✨ Dù thị trường quay đầu, bạn chắc chắn vẫn bỏ túi +1.0R lợi nhuận!
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
🎯 <b>CHỐT LỜI THÀNH CÔNG (TP HIT): ${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
🚀 <b>Đóng 100% vị thế tại TP:</b> <code>${exitPrice}</code>
💰 <b>Lợi nhuận đạt:</b> <b>+${pnlR.toFixed(2)}R</b>
💵 <b>Thực nhận (sau phí Taker):</b> <b>+$${netPnlUsd.toFixed(2)} USDT</b>
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
${title}: <b>${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
📉 <b>Giá khớp thoát:</b> <code>${exitPrice}</code>
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
📉 <b>Stop Loss tại:</b> <code>${position.stopLoss}</code>
🛑 <b>Lỗ:</b> <b>-1.0R (-$10.00 USDT)</b>

🔍 <b>MỔ XẺ ĐIỂM SAI CỦA BOT:</b>
• <b>Giai đoạn nến H4:</b> <code>${mistake.marketPhase}</code>
• <b>Lỗi vi phạm:</b> <b>${mistake.mistakeTitle}</b>
• <b>Chi tiết:</b> ${mistake.rootCause}

⚖️ <b>HÌNH PHẠT ĐANG THI HÀNH:</b>
• ⏳ <b>Đóng băng ${position.symbol}:</b> ${penalty.cooldownHours} tiếng (đến ${penalty.penaltyUntilStr}).
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
⚠️ Sau 4 giờ dao động đi ngang trong biên độ hẹp, hệ thống chủ động đóng lệnh tại <code>${exitPrice}</code>.
💵 <b>PnL ròng:</b> $${netPnlUsd.toFixed(2)} USDT
🔄 Thu hồi vốn để dồn cho các cơ hội cấu trúc sắc nét hơn!
`.trim();

  await sendTelegramMessage(msg);
}

