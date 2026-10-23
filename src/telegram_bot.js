/**
 * TELEGRAM_BOT.JS
 * Trợ lý AI Tương tác 2 Chiều trên Telegram powered by Gemini 3.8 Flash.
 * 
 * Khả năng:
 * 1. Nhận ảnh chụp màn hình biểu đồ (TradingView / OKX) -> Gemini 3.8 Flash Vision tự đọc nến, kháng cự/hỗ trợ và kịch bản.
 * 2. Lệnh /canh, /radar, /plan: Bản đồ cản canh trước đón đầu Top 6 coin.
 * 3. Lệnh /btc, /eth, /sol, /link, /near, /hype: Soi chi tiết đa khung thời gian.
 */

import dotenv from 'dotenv';
import { generateKeyLevelRadar } from './engine.js';
import { analyzeChartScreenshot, callGemini } from './ai_agent.js';
import { sendTelegramMessage } from './telegram.js';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PREMIER_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'LINK-USDT', 'NEAR-USDT', 'HYPE-USDT'];

let isPolling = false;
let lastUpdateId = 0;

/**
 * Lấy file ảnh từ Telegram server và chuyển thành Buffer
 * @param {string} fileId 
 * @returns {Promise<Buffer|null>}
 */
async function downloadTelegramPhoto(fileId) {
  try {
    const getFileUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
    const res = await fetch(getFileUrl);
    const data = await res.json();
    if (!data.ok || !data.result?.file_path) {
      throw new Error('Không lấy được đường dẫn file từ Telegram');
    }

    const filePath = data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const fileRes = await fetch(downloadUrl);
    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('[TELEGRAM BOT] Lỗi tải ảnh:', err.message);
    return null;
  }
}

/**
 * Xử lý lệnh /radar, /canh, /plan
 * @param {Function} fetchOkxCandlesFn 
 * @returns {Promise<string>}
 */
export async function handleRadarCommand(fetchOkxCandlesFn) {
  let report = `<b>🧭 BẢN ĐỒ CẢN CANH TRƯỚC (TOP 6 PREMIER COINS)</b>\n`;
  report += `━━━━━━━━━━━━━━━━━━━━\n`;
  report += `<i>Kịch bản đón đầu trước tại các vùng cản cứng Smart Money</i>\n\n`;

  let hasApproaching = false;

  for (const sym of PREMIER_SYMBOLS) {
    try {
      const instId = `${sym}-SWAP`;
      const candlesH4 = await fetchOkxCandlesFn(instId, '4H', 60);
      if (!candlesH4 || candlesH4.length < 20) continue;

      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const curPrice = closedH4[closedH4.length - 1].close;

      const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice });
      if (!radar) continue;

      const trendIcon = radar.trendH4 === 'BULL' ? '🟢 Tăng' : '🔴 Giảm';

      report += `🔹 <b>${sym}</b>: <code>${curPrice}</code> (${trendIcon} EMA34/89)\n`;
      if (radar.nearestRes) {
        report += `  🔺 Cản gần: <code>${radar.nearestRes}</code> (cách +${radar.distToResPct}%)\n`;
      }
      if (radar.nearestSup) {
        report += `  🔻 Hỗ trợ: <code>${radar.nearestSup}</code> (cách -${radar.distToSupPct}%)\n`;
      }

      if (radar.radarStatus !== 'NEUTRAL') {
        hasApproaching = true;
        report += `  ⚡ <b>Kịch bản:</b> ${radar.scenario}\n`;
      }
      report += `\n`;
    } catch (err) {
      console.error(`[RADAR] Lỗi xử lý ${sym}:`, err.message);
    }
  }

  if (!hasApproaching) {
    report += `💡 <i>Hiện tại các coin đang dao động ở vùng giữa dải. Tiếp tục theo dõi nến M15 phản ứng!</i>\n`;
  }

  return report;
}

/**
 * Xử lý mọi câu hỏi tự do bằng văn bản (Natural Language) qua Gemini 3.8 Flash
 * @param {string} query 
 * @param {Function} fetchOkxCandlesFn 
 * @returns {Promise<string>}
 */
export async function handleGeneralChatQuery(query, fetchOkxCandlesFn) {
  try {
    const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
    const snapshot = [];
    for (const sym of symbols) {
      try {
        const candles = await fetchOkxCandlesFn(`${sym}-SWAP`, '1H', 5);
        if (candles && candles.length > 0) {
          snapshot.push(`${sym}: ${candles[candles.length - 1].close}`);
        }
      } catch {}
    }
    const marketCtx = snapshot.join(' | ');

    const prompt = `Bạn là Trợ lý AI Giao Dịch Định Lượng của hệ thống Quant Bot (SMC v3.0 & Kane Sonic R EMAs 34/89).
Người dùng trên Telegram vừa hỏi/nhắn: "${query}".

Dữ liệu thị trường thời gian thực:
${marketCtx}

Yêu cầu trả lời:
1. Trả lời trực tiếp, thông minh, tận tình bằng tiếng Việt.
2. Dùng kiến thức Smart Money Concepts (SMC - Săn thanh khoản, Đỉnh/Đáy, Bẫy Inducement, Quét râu) và Kane Sonic R.
3. Nếu người dùng hỏi về kịch bản/kèo/thị trường, hãy tóm tắt kịch bản hành động chuẩn xác.
4. Định dạng câu trả lời bằng HTML Telegram (<b>in đậm</b>, <code>mã/giá</code>, <i>in nghiêng</i>). KHÔNG dùng markdown **.
5. Ngắn gọn, súc tích (khoảng 2-3 đoạn), thân thiện và chuyên nghiệp.`;

    const answer = await callGemini(prompt);
    return answer;
  } catch (err) {
    return `🤖 <b>Trợ lý Bot:</b> Tôi đã nhận được tin nhắn "${query}". Bạn có thể gõ <code>/radar</code> để xem kịch bản cản cứng Top 6 coin, <code>/status</code> để xem trạng thái bot, hoặc chụp ảnh biểu đồ gửi vào đây để tôi soi chi tiết nhé!`;
  }
}

/**
 * Bắt đầu vòng lặp Long-Polling Telegram
 * @param {object} context - Chứa hàm fetchOkxCandles
 */
export async function startTelegramListener(context = {}) {
  if (!BOT_TOKEN) {
    console.log('[TELEGRAM BOT] Chưa có TELEGRAM_BOT_TOKEN -> Bỏ qua chế độ Bot tương tác.');
    return;
  }

  const { fetchOkxCandles } = context;
  if (!fetchOkxCandles) {
    console.warn('[TELEGRAM BOT] Thiếu hàm fetchOkxCandles, listener không thể kích hoạt đầy đủ.');
    return;
  }

  if (isPolling) return;
  isPolling = true;

  // Xóa webhook cũ (nếu có) để getUpdates hoạt động 100% trơn tru, chống nghẽn tin nhắn
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
  } catch (e) {}

  // Tự động đồng bộ Menu lệnh chuẩn Premier (loại bỏ memecoin, lệnh cũ)
  try {
    const commands = [
      { command: 'status', description: '📊 Trạng thái Bot, số vị thế & quét thị trường' },
      { command: 'radar', description: '🧭 Bản đồ cản cứng đón đầu (Top 6 Coin Lớn)' },
      { command: 'btc', description: '🔍 Soi kịch bản nến & cản BTC-USDT' },
      { command: 'eth', description: '🔍 Soi kịch bản nến & cản ETH-USDT' },
      { command: 'sol', description: '🔍 Soi kịch bản nến & cản SOL-USDT' },
      { command: 'link', description: '🔍 Soi kịch bản nến & cản LINK-USDT' },
      { command: 'near', description: '🔍 Soi kịch bản nến & cản NEAR-USDT' },
      { command: 'hype', description: '🔍 Soi kịch bản nến & cản HYPE-USDT' },
      { command: 'help', description: '💡 Hướng dẫn & gửi ảnh chart cho Gemini AI' }
    ];
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
  } catch (e) {}

  console.log('[TELEGRAM BOT] 🚀 Đã kích hoạt Trợ lý AI Tương tác 2 Chiều (@VictorHuynh_trading_bot)...');

  const pollLoop = async () => {
    while (isPolling) {
      try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = update.update_id;
            const msg = update.message;
            if (!msg) continue;

            const chatId = msg.chat?.id;
            const text = (msg.text || '').trim().toLowerCase();

            // 1. Xử lý ảnh chụp màn hình biểu đồ (Multimodal Vision)
            if (msg.photo && msg.photo.length > 0) {
              const bestPhoto = msg.photo[msg.photo.length - 1];
              await sendTelegramMessage(`🧠 <b>Gemini 3.8 Flash Vision đang soi chart của bạn...</b>\n<i>Đang bóc tách nến, kháng cự/hỗ trợ và kịch bản đón đầu. Vui lòng đợi trong giây lát!</i>`);

              const imgBuffer = await downloadTelegramPhoto(bestPhoto.file_id);
              if (imgBuffer) {
                const base64 = imgBuffer.toString('base64');
                try {
                  const analysis = await analyzeChartScreenshot(base64, 'image/jpeg');
                  await sendTelegramMessage(analysis);
                } catch (err) {
                  await sendTelegramMessage(`⚠️ Lỗi phân tích ảnh qua Gemini: ${err.message}`);
                }
              }
              continue;
            }

            // 2. Xử lý tin nhắn text (hỗ trợ cả lệnh /command lẫn ngôn ngữ tự nhiên không cần gõ gạch chéo)
            const rawText = (msg.text || '').trim();
            const lowerText = rawText.toLowerCase();
            const cleanText = lowerText.replace(/^\//, '').trim();

            if (lowerText === '/start' || lowerText === '/help' || cleanText === 'help' || cleanText === 'trợ giúp' || cleanText === 'tro giup') {
              const welcome = `
🤖 <b>CHÀO MỪNG ĐẾN VỚI ANTIGRAVITY QUANT TRADING BOT</b>
━━━━━━━━━━━━━━━━━━━━
Hệ thống giao dịch Smart Money Concepts (SMC) & Kane Sonic R (EMAs 34/89) tích hợp siêu trí tuệ <b>Gemini 3.8 Flash</b>.

📌 <b>CÁC LỆNH HỖ TRỢ (Gõ có hoặc không có dấu / đều được):</b>
• <code>/status</code>: Kiểm tra trạng thái server, số vị thế mở, danh sách coin quét.
• <code>/radar</code> hoặc <code>/canh</code> hoặc <code>kịch bản</code>: Xem Bản Đồ Cản Canh Trước (Đón đầu tại đỉnh/đáy) Top 6 Coin lớn.
• <code>/btc</code>, <code>/eth</code>, <code>/sol</code>, <code>/link</code>, <code>/near</code>, <code>/hype</code>: Soi nhanh coin cụ thể.
• 💬 <b>HỎI BẤT KỲ CÂU HỎI NÀO:</b> Bạn có thể nhắn bất kỳ câu hỏi nào bằng tiếng Việt, Gemini 3.8 Flash sẽ trả lời kèm dữ liệu thị trường trực tiếp!
• 📸 <b>GỬI ẢNH BIỂU ĐỒ (SCREENSHOT):</b> Chụp ảnh biểu đồ trên OKX / TradingView gửi vào đây, Gemini 3.8 Flash sẽ lập tức soi cản và đưa ra kịch bản chi tiết!
              `.trim();
              await sendTelegramMessage(welcome);
            } else if (
              ['status', 'positions', 'ping', 'trạng thái', 'trang thai', 'tình hình', 'tinh hinh', 'vị thế', 'vi the'].some(k => cleanText === k || cleanText.startsWith(k))
            ) {
              const getPositionsFn = context.getActivePositions;
              const positions = typeof getPositionsFn === 'function' ? getPositionsFn() : [];
              const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
              let reply = `🟢 <b>SERVER BOT HOẠT ĐỘNG BÌNH THƯỜNG</b>\n`;
              reply += `━━━━━━━━━━━━━━━━━━━━\n`;
              reply += `⏱️ <b>Thời gian:</b> <code>${timeStr}</code>\n`;
              reply += `📡 <b>Chu kỳ quét:</b> <code>Mỗi 60 giây (Live OKX)</code>\n`;
              reply += `🎯 <b>Chiến lược:</b> <code>SMC v3.0 Alpha + Sonic R</code>\n`;
              reply += `💎 <b>Danh mục quét (6 coin):</b> <code>BTC, ETH, SOL, LINK, NEAR, HYPE</code>\n`;
              reply += `🛡️ <b>Bộ lọc:</b> <code>H1 ADX > 20 | Tỷ lệ nén ATR >= 0.70 | Maker 0.02%</code>\n\n`;
              if (positions && positions.length > 0) {
                reply += `📊 <b>VỊ THẾ ĐANG MỞ (${positions.length}/2):</b>\n`;
                for (const pos of positions) {
                  reply += `  • <b>${pos.symbol}</b> ${pos.direction} (Entry: ${pos.entry}, SL: ${pos.stopLoss}, TP: ${pos.takeProfit})\n`;
                }
              } else {
                reply += `📊 <b>Vị thế đang mở:</b> <code>0/2 (Đang rình setup A+)</code>\n`;
              }
              reply += `\n💡 <i>Gõ /radar để xem khoảng cách tới các cản gần nhất.</i>`;
              await sendTelegramMessage(reply);
            } else if (
              ['canh', 'radar', 'plan', 'keo', 'kèo', 'kịch bản', 'kich ban', 'bản đồ', 'ban do'].some(k => cleanText.includes(k))
            ) {
              const report = await handleRadarCommand(fetchOkxCandles);
              await sendTelegramMessage(report);
            } else if (
              PREMIER_SYMBOLS.some(s => {
                const coinName = s.replace('-USDT', '').toLowerCase();
                return cleanText === coinName || cleanText.startsWith(coinName) || cleanText.endsWith(coinName);
              })
            ) {
              const matchedSym = PREMIER_SYMBOLS.find(s => {
                const coinName = s.replace('-USDT', '').toLowerCase();
                return cleanText.includes(coinName);
              });
              const sym = matchedSym || 'BTC-USDT';
              const instId = `${sym}-SWAP`;
              const candlesH4 = await fetchOkxCandles(instId, '4H', 60);
              if (candlesH4 && candlesH4.length >= 20) {
                const closedH4 = candlesH4.filter(c => c.confirm === 1);
                const curPrice = closedH4[closedH4.length - 1].close;
                const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice });
                if (radar) {
                  const reply = `
🔍 <b>PHÂN TÍCH NHANH: ${sym}</b>
━━━━━━━━━━━━━━━━━━━━
💵 <b>Giá hiện tại:</b> <code>${curPrice}</code>
📈 <b>Xu hướng H4 (EMA34/89):</b> ${radar.trendH4 === 'BULL' ? '🟢 TĂNG' : '🔴 GIẢM'}
🔺 <b>Cản gần nhất:</b> <code>${radar.nearestRes || 'N/A'}</code> (${radar.distToResPct !== null ? '+' + radar.distToResPct + '%' : ''})
🔻 <b>Hỗ trợ gần nhất:</b> <code>${radar.nearestSup || 'N/A'}</code> (${radar.distToSupPct !== null ? '-' + radar.distToSupPct + '%' : ''})
🎯 <b>Kịch bản:</b> ${radar.scenario}
                  `.trim();
                  await sendTelegramMessage(reply);
                }
              }
            } else if (rawText.length > 0) {
              // Bất kỳ câu hỏi / tin nhắn tự do nào khác -> Gemini 3.8 Flash trả lời thông minh
              const reply = await handleGeneralChatQuery(rawText, fetchOkxCandles);
              await sendTelegramMessage(reply);
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[TELEGRAM BOT] Lỗi Polling:', err.message);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  };

  // Chạy ngầm không chặn main thread
  pollLoop();
}

export function stopTelegramListener() {
  isPolling = false;
}

