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
export async function sendTelegramMessage(text) {
  const cleanedText = stripMarkdownAsterisks(text);

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
export async function notifyNewSignal(signal) {
  const isLong = signal.direction === 'LONG';
  const icon = isLong ? '🟢' : '🔴';
  const dirText = isLong ? 'MUA (LONG)' : 'BÁN (SHORT)';
  // PHÂN HẠNG CHẤT LƯỢNG KÈO: backtest cho thấy điểm càng cao thì win rate &
  // PF càng cao (75đ: WR 52%/PF 1.70 | 85đ+: WR 58%/PF 2.04). Giữ nguyên
  // ngưỡng vào lệnh 75 (để không bỏ lỡ tổng lợi nhuận), nhưng gắn NHÃN hạng
  // để người dùng biết con nào "chắc ăn" hơn mà cân nhắc chú ý/vào tay thêm.
  let tierTag = '';
  if (signal.qualityScore >= 90) tierTag = '\n👑 <b>HẠNG KÈO:</b> <code>SIÊU VIP S (Win rate cao nhất)</code>';
  else if (signal.qualityScore >= 85) tierTag = '\n💎 <b>HẠNG KÈO:</b> <code>VIP A+ (Thắng ~58%, PF 2.0+)</code>';
  else if (signal.qualityScore >= 80) tierTag = '\n⭐ <b>HẠNG KÈO:</b> <code>A (Thắng ~54%)</code>';
  else tierTag = '\n✅ <b>HẠNG KÈO:</b> <code>Chuẩn B (Thắng ~52%)</code>';

  const scoreInfo = signal.qualityScore ? `\n⚡ <b>Điểm Sức Mạnh:</b> <code>${signal.qualityScore}/100 pts</code>${tierTag}` : '';
  const reasonInfo = signal.qualityReasons && signal.qualityReasons.length > 0 ? `\n⭐ <b>Hội tụ sức mạnh:</b> ${signal.qualityReasons.join(' | ')}` : '';
  const orderTypeTag = `\n🏷️ <b>Khớp Lệnh:</b> <code>Limit Post-Only (Phí Maker 0.02%)</code>`;

  const msg = `
🧪 <b>[PAPER TRADE MÔ PHỎNG]</b>
${icon} <b>${dirText} 10X: ${signal.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
💵 <b>Entry (Limit):</b> <code>${signal.entry}</code>
🛑 <b>SL:</b> <code>${signal.stopLoss}</code>
🎯 <b>TP:</b> <code>${signal.takeProfit}</code>${orderTypeTag}${scoreInfo}${reasonInfo}
📝 <b>Lý do:</b> ${signal.reason}
🛡️ <b>Quản trị vốn:</b> Giả lập rủi ro 1R = $10 (Không mất tiền thật)
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
🧪 <b>[PAPER TRADE]</b> 🔒 <b>KÍCH HOẠT KHÓA LỢI NHUẬN (+1.5R ➔ SL +1.0R): ${position.symbol}</b>
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
🧪 <b>[PAPER TRADE]</b> 🎯 <b>CHỐT LỜI THÀNH CÔNG (TP HIT): ${position.symbol}</b>
━━━━━━━━━━━━━━━━━━━━
🚀 <b>Đóng 100% vị thế tại TP:</b> <code>${exitPrice}</code>
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
⚠️ Sau 4 giờ dao động đi ngang trong biên độ hẹp, hệ thống chủ động đóng lệnh tại <code>${exitPrice}</code>.
💵 <b>PnL ròng:</b> $${netPnlUsd.toFixed(2)} USDT
🔄 Thu hồi vốn để dồn cho các cơ hội cấu trúc sắc nét hơn!
`.trim();

  await sendTelegramMessage(msg);
}

