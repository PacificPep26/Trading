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
import { analyzeChartScreenshot, callGemini, loadKnowledgeBase } from './ai_agent.js';
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
 * Đạt trình độ phân tích sâu sắc, sắc bén như Antigravity AI Assistant.
 * @param {string} query 
 * @param {Function} fetchOkxCandlesFn 
 * @returns {Promise<string>}
 */
export async function handleGeneralChatQuery(query, fetchOkxCandlesFn, positions = []) {
  try {
    const symbols = PREMIER_SYMBOLS;

    // 1. Quét song song H4 cho cả 6 coin để tiết kiệm thời gian (<500ms)
    const h4Promises = symbols.map(async sym => {
      try {
        const instId = `${sym}-SWAP`;
        const candlesH4 = await fetchOkxCandlesFn(instId, '4H', 60);
        if (!candlesH4 || candlesH4.length < 20) return null;
        const closedH4 = candlesH4.filter(c => c.confirm === 1);
        const curPrice = closedH4[closedH4.length - 1].close;
        const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice });
        if (!radar) return null;
        return {
          symbol: sym,
          price: curPrice,
          trendH4: radar.trendH4,
          nearestResistance: radar.nearestRes,
          distToRes: radar.distToResPct + '%',
          nearestSupport: radar.nearestSup,
          distToSup: radar.distToSupPct + '%',
          scenario: radar.scenario
        };
      } catch {
        return null;
      }
    });

    // 2. Lấy thêm bối cảnh vĩ mô D1 và nến M15 của BTC
    const d1Promise = (async () => {
      try {
        const candlesD1 = await fetchOkxCandlesFn('BTC-USDT-SWAP', '1D', 15);
        if (!candlesD1 || candlesD1.length === 0) return null;
        const lastD1 = candlesD1[candlesD1.length - 1];
        const recentHigh = Math.max(...candlesD1.map(c => c.high));
        const recentLow = Math.min(...candlesD1.map(c => c.low));
        return {
          currentD1: { open: lastD1.open, high: lastD1.high, low: lastD1.low, close: lastD1.close },
          swingHigh15D: recentHigh,
          swingLow15D: recentLow
        };
      } catch {
        return null;
      }
    })();

    const m15Promise = (async () => {
      try {
        const candlesM15 = await fetchOkxCandlesFn('BTC-USDT-SWAP', '15m', 8);
        if (!candlesM15 || candlesM15.length === 0) return null;
        return candlesM15.slice(-5).map(c => ({
          time: new Date(c.ts).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          isBullish: c.close >= c.open,
          range: +(c.high - c.low).toFixed(1)
        }));
      } catch {
        return null;
      }
    })();

    const [h4Snapshots, d1Context, m15Recent] = await Promise.all([
      Promise.all(h4Promises),
      d1Promise,
      m15Promise
    ]);

    const validSnapshots = h4Snapshots.filter(Boolean);
    const marketCtx = JSON.stringify({
      top6RadarH4: validSnapshots,
      btcVĩMôD1: d1Context,
      btcPriceActionM15: m15Recent,
      viThePaperTradeDangMo: positions && positions.length > 0
        ? positions.map(p => ({ symbol: p.symbol, direction: p.direction, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit, isProfitLocked: p.isProfitLocked }))
        : 'Không có vị thế nào đang mở'
    }, null, 2);

    const kbContext = loadKnowledgeBase();

    const prompt = `Người dùng vừa hỏi: "${query}"

Dữ liệu thị trường thời gian thực quét trực tiếp từ sàn OKX:
${marketCtx}

Tài liệu chiến lược & bài học thực chiến của chính hệ thống (dùng để trả lời đúng theo cách bot THẬT đang vận hành, không phải lý thuyết chung chung):
${kbContext}`;

    const systemInstruction = `Bạn là Antigravity Quant Trader — Bộ Não AI của hệ thống Trading Tự động (Victor Trading Bot) trên sàn OKX.
Bạn là chuyên gia đỉnh cao về Smart Money Concepts (SMC), Price Action nến Nhật và Dr. Kane Sonic R (EMAs 34/89).

NGUYÊN TẮC VÀ LOGIC HỆ THỐNG CỦA BẠN:
0. VỊ THẾ PAPER TRADE ĐANG MỞ: dữ liệu bên dưới (key "viThePaperTradeDangMo") là SỰ THẬT về lệnh bot đang mô phỏng - LUÔN kiểm tra trường này trước khi trả lời. Nếu người dùng hỏi về lệnh họ đang giữ, PnL, nên chốt/giữ, hay bất kỳ câu nào liên quan vị thế, PHẢI dựa đúng vào entry/SL/TP/isProfitLocked ở đây, không bịa hoặc nói chung chung.
1. ĐA KHUNG THỜI GIAN:
   - D1: Định hướng vĩ mô (chu kỳ đỉnh/đáy, vị trí so với MA/EMA ngày).
   - H4: Xác định cấu trúc thị trường (Trend EMA 34/89, Key Levels Tier-2, vùng bẫy thanh khoản Inducement).
   - M15: Xác nhận tín hiệu vào lệnh (Trigger Confirmation).
2. KỊCH BẢN ĐÓN ĐẦU & KHÔNG ĐẶT LIMIT THỤ ĐỘNG:
   - Hệ thống có Bản Đồ Cản Canh Trước (Radar) để biết trước cá mập sẽ gom/xả ở đâu.
   - Nhưng TUYỆT ĐỐI KHÔNG đặt lệnh Limit thụ động đón dao rơi vì nến đỏ/xanh xả hàng mạnh (Displacement) sẽ xuyên thủng cản gây dính Stop Loss.
   - Chỉ vào lệnh khi NẾN M15 XÁC NHẬN: Rút râu (Pinbar/Sweep >= 40%) từ chối giá hoặc nến đảo chiều đóng nến xác nhận xu hướng.
3. PHÂN BIỆT NẾN THÂN DÀI VÀ PHÁ NỀN:
   - Hệ thống phân biệt rõ: Nến Marubozu thân dài (bodySize/range >= 65%), Nến rút râu quét thanh khoản, Nến nén do dự.
   - Khi giá phá nền (Breakout): Hệ thống nhận diện được ngay nhưng TUYỆT ĐỐI KHÔNG MUA ĐU ĐỈNH. Hệ thống chờ nhịp PULLBACK về mép nền/Breaker Block/EMA34 để có Risk:Reward tối ưu (tối thiểu 1:2.0).
4. TẠI SAO ĐI NGANG KHÔNG VÀO LỆNH:
   - Khi thị trường sideway biên hẹp ru ngủ (ADX H1 < 20 hoặc nén ATR), bộ lọc hệ thống KHÓA CHẶT lệnh để bảo vệ vốn, chống bị cào phí và dính bẫy chop 2 đầu. Đứng ngoài là kỷ luật đỉnh cao của Quỹ.

PHONG CÁCH TRẢ LỜI:
- Trả lời trực tiếp, thông minh, sâu sắc, sòng phẳng, đầy đủ dẫn chứng số liệu thực tế bằng tiếng Việt.
- Bắt buộc dùng định dạng HTML Telegram chuẩn (<b>in đậm</b>, <code>code</code>, <i>in nghiêng</i>). TUYỆT ĐỐI KHÔNG dùng markdown **.
- Ngắn gọn, súc tích (khoảng 3-4 đoạn), cuốn hút và tạo cảm hứng giao dịch kỷ luật.`;

    const answer = await callGemini(prompt, systemInstruction);
    return answer;
  } catch (err) {
    console.error('[TELEGRAM BOT] Lỗi handleGeneralChatQuery:', err.message);
    return `🤖 <b>Trợ lý Bot:</b> Tôi đã nhận được tin nhắn "${query}". Hiện tại hệ thống đang kết nối trực tiếp với OKX. Bạn có thể gõ <code>/radar</code> để xem bản đồ cản canh trước, hoặc <code>/status</code> để xem tình trạng bot!`;
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
              reply += `🧪 <b>Chế độ khớp lệnh:</b> <code>Paper Trading (Mô phỏng 100% an toàn)</code>\n`;
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
              const getPositionsFn2 = context.getActivePositions;
              const curPositions = typeof getPositionsFn2 === 'function' ? getPositionsFn2() : [];
              const reply = await handleGeneralChatQuery(rawText, fetchOkxCandles, curPositions);
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

