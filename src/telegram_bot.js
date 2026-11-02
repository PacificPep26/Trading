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
import { sendTelegramMessage, formatPrice } from './telegram.js';
import { calculateEMA, calculateADX, findFairValueGaps } from './indicators.js';
import { detectMacroRangeBox } from './strategies/macro_range.js';
import { getEffectiveConfig } from './config.js';

// Bộ nhớ hội thoại ngắn hạn (RAM, mất khi restart server - đủ dùng cho chat
// 1-user, không cần phức tạp hóa thành file/DB). Giữ 6 cặp hỏi-đáp gần nhất
// để Gemini "nhớ" mạch chat, tránh mỗi câu trả lời như người lạ mới gặp.
const MAX_CHAT_HISTORY = 6;
let chatHistory = [];

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
      const [candlesH4, candlesD1, candlesH1, candlesW1] = await Promise.all([
        fetchOkxCandlesFn(instId, '4H', 300),
        fetchOkxCandlesFn(instId, '1Dutc', 300),
        fetchOkxCandlesFn(instId, '1H', 300),
        fetchOkxCandlesFn(instId, '1W', 100)
      ]);
      if (!candlesH4 || candlesH4.length < 20) continue;

      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const curPrice = closedH4[closedH4.length - 1].close;

      const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice, candlesH1, candlesD1, candlesW1 });
      if (!radar) continue;

      let trendIcon = '🔴 Giảm';
      if (radar.trendH4 === 'STRONG_DOWNTREND') trendIcon = '🔴 Xu Hướng Giảm Mạnh';
      else if (radar.trendH4 === 'STRONG_UPTREND') trendIcon = '🟢 Xu Hướng Tăng Mạnh';
      else if (radar.trendH4 === 'BULL' || radar.trendH4 === 'RANGING_BULL') trendIcon = '🟢 Tăng';
      else if (radar.trendH4 === 'BEAR' || radar.trendH4 === 'RANGING_BEAR') trendIcon = '🔴 Giảm';

      report += `🔹 <b>${sym}</b>: <code>${curPrice}</code> (${trendIcon})\n`;
      if (radar.nearestRes) {
        report += `  🔺 Cản gần: <code>${radar.nearestRes}</code> (cách +${radar.distToResPct}%)\n`;
      }
      if (radar.nearestSup) {
        report += `  🔻 Hỗ trợ: <code>${radar.nearestSup}</code> (cách -${radar.distToSupPct}%)\n`;
      }
      if (radar.pwh || radar.pwl || radar.consecutiveRedWeeks) {
        const wInfo = [];
        if (radar.consecutiveRedWeeks >= 2) wInfo.push(`${radar.consecutiveRedWeeks} tuần đỏ liên tiếp`);
        if (radar.pwl) wInfo.push(`PWL: ${radar.pwl}`);
        if (radar.pwh) wInfo.push(`PWH: ${radar.pwh}`);
        if (radar.ema34W1) wInfo.push(`EMA34-W1: ${radar.ema34W1}`);
        if (wInfo.length > 0) {
          report += `  📅 <i>Vĩ mô Tuần (W1): ${wInfo.join(' | ')}</i>\n`;
        }
      }

      if (radar.limitPlan) {
        const lp = radar.limitPlan;
        if (lp.type === 'MACRO_BOX_LIMITS') {
          report += `  📦 <b>Hộp Vĩ Mô:</b> [${lp.rangeLow} - ${lp.rangeHigh}] (Trục: ${lp.equilibrium})\n`;
          report += `  📌 <b>Kế hoạch Limit đón đầu (${lp.isAlphaIndependent ? 'Coin Độc Lập' : 'Cản Vĩ Mô'}):</b>\n`;
          report += `     • 🔴 Short Limit: <code>${lp.shortLimit.entry}</code> | SL: <code>${lp.shortLimit.sl}</code> | TP: <code>${lp.shortLimit.tp2}</code> (RR 1:${lp.shortLimit.rr})\n`;
          report += `     • 🟢 Long Limit: <code>${lp.longLimit.entry}</code> | SL: <code>${lp.longLimit.sl}</code> | TP: <code>${lp.longLimit.tp2}</code> (RR 1:${lp.longLimit.rr})\n`;
        } else if (lp.type === 'PIVOT_LIMITS') {
          report += `  📌 <b>Limit Đón Đầu:</b> Short <code>${lp.shortLimit.entry}</code> (SL ${lp.shortLimit.sl}) | Long <code>${lp.longLimit.entry}</code> (SL ${lp.longLimit.sl})\n`;
        }
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

function extractMentionedCoins(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const matched = [];
  const coinMap = {
    'hype': 'HYPE-USDT',
    'hyperliquid': 'HYPE-USDT',
    'btc': 'BTC-USDT',
    'bitcoin': 'BTC-USDT',
    'eth': 'ETH-USDT',
    'ethereum': 'ETH-USDT',
    'sol': 'SOL-USDT',
    'solana': 'SOL-USDT',
    'link': 'LINK-USDT',
    'chainlink': 'LINK-USDT',
    'near': 'NEAR-USDT'
  };
  for (const [key, sym] of Object.entries(coinMap)) {
    const regex = new RegExp(`(^|\\W)${key}(\\W|$)`, 'i');
    if (regex.test(t) && !matched.includes(sym)) {
      matched.push(sym);
    }
  }
  return matched;
}

/**
 * Xử lý mọi câu hỏi tự do bằng văn bản (Natural Language) qua Gemini 3.8 Flash
 * Đạt trình độ phân tích sâu sắc, sắc bén như Antigravity AI Assistant.
 * @param {string} query 
 * @param {Function} fetchOkxCandlesFn 
 * @returns {Promise<string>}
 */
export async function handleGeneralChatQuery(query, fetchOkxCandlesFn, positions = [], pendingSignals = []) {
  try {
    const symbols = PREMIER_SYMBOLS;

    // 1. Quét song song H4 cho cả 6 coin để tiết kiệm thời gian (<300ms)
    const h4Promises = symbols.map(async sym => {
      try {
        const instId = `${sym}-SWAP`;
        const candlesH4 = await fetchOkxCandlesFn(instId, '4H', 100);
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

    // 2. Lấy bối cảnh vĩ mô Tối Đa: Nến Tuần (W1 - 50 tuần) & Nến Ngày (D1 - 100 ngày) của BTC
    const w1Promise = (async () => {
      try {
        const candlesW1 = await fetchOkxCandlesFn('BTC-USDT-SWAP', '1W', 100);
        if (!candlesW1 || candlesW1.length === 0) return null;
        const closedW1 = candlesW1.filter(c => c.confirm === 1);
        const lastClosedW1 = closedW1[closedW1.length - 1];
        const curW1 = candlesW1[candlesW1.length - 1];

        let consecutiveRedWeeks = 0;
        for (let i = closedW1.length - 1; i >= 0; i--) {
          if (closedW1[i].close < closedW1[i].open) consecutiveRedWeeks++;
          else break;
        }
        if (curW1.close < curW1.open) consecutiveRedWeeks++;

        // 10 tuần gần nhất
        const last10Weeks = candlesW1.slice(-10).map(c => ({
          date: new Date(c.ts).toISOString().split('T')[0],
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          isBullish: c.close >= c.open
        }));

        return {
          soTuanDoLienTiep: consecutiveRedWeeks,
          tuanHienTaiDangChay: { open: curW1.open, high: curW1.high, low: curW1.low, close: curW1.close },
          tuanTruocPWH: lastClosedW1 ? lastClosedW1.high : null,
          tuanTruocPWL: lastClosedW1 ? lastClosedW1.low : null,
          hoTroTuanCungNhat: '75,800 - 76,200 (đáy tháng 8-9) và 74,896 (đáy sâu nhất tháng 9)',
          lichSu10TuanGanNhat: last10Weeks
        };
      } catch {
        return null;
      }
    })();

    const d1Promise = (async () => {
      try {
        const candlesD1 = await fetchOkxCandlesFn('BTC-USDT-SWAP', '1Dutc', 300);
        if (!candlesD1 || candlesD1.length === 0) return null;
        const lastD1 = candlesD1[candlesD1.length - 1];
        const recentHigh30D = Math.max(...candlesD1.slice(-30).map(c => c.high));
        const recentLow30D = Math.min(...candlesD1.slice(-30).map(c => c.low));
        return {
          currentD1: { open: lastD1.open, high: lastD1.high, low: lastD1.low, close: lastD1.close },
          swingHigh30D: recentHigh30D,
          swingLow30D: recentLow30D,
          soNgayQuanSat: candlesD1.length
        };
      } catch {
        return null;
      }
    })();

    const m15Promise = (async () => {
      try {
        const candlesM15 = await fetchOkxCandlesFn('BTC-USDT-SWAP', '15m', 100);
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

    // 3. Phân tích CHUYÊN SÂU TẬN GỐC cho coin mà người dùng đang hỏi (Coin-Specific Deep Scanner)
    let focusSymbols = extractMentionedCoins(query);
    if (focusSymbols.length === 0) {
      if (/fvg|short|long|keo|kèo|rơi|rớt|sao k|sao không|đáy|đỉnh|altcoin/i.test(query)) {
        focusSymbols = ['HYPE-USDT', 'BTC-USDT'];
      } else {
        focusSymbols = ['BTC-USDT'];
      }
    }

    const focusPromises = focusSymbols.map(async sym => {
      try {
        const instId = `${sym}-SWAP`;
        const [cM15, cH1, cH4, cD1, cW1] = await Promise.all([
          fetchOkxCandlesFn(instId, '15m', 80),
          fetchOkxCandlesFn(instId, '1H', 150),
          fetchOkxCandlesFn(instId, '4H', 120),
          fetchOkxCandlesFn(instId, '1Dutc', 100),
          fetchOkxCandlesFn(instId, '1W', 50)
        ]);

        const closedM15 = (cM15 || []).filter(c => c.confirm === 1);
        const closedH1 = (cH1 || []).filter(c => c.confirm === 1);
        const closedH4 = (cH4 || []).filter(c => c.confirm === 1);
        const closedD1 = (cD1 || []).filter(c => c.confirm === 1);
        const closedW1 = (cW1 || []).filter(c => c.confirm === 1);

        if (closedM15.length === 0) return null;

        const curPrice = closedM15[closedM15.length - 1].close;

        // Chỉ số ADX H1 (Chop Sleep Mode)
        let curAdx = null;
        let isChopSleep = false;
        if (closedH1.length >= 28) {
          const adxArr = calculateADX(closedH1, 14);
          const lastAdx = adxArr[adxArr.length - 1];
          if (lastAdx && lastAdx.adx !== null) {
            curAdx = +lastAdx.adx.toFixed(1);
            isChopSleep = curAdx <= 20;
          }
        }

        // Dynamic EMAs
        const ema34H1Val = calculateEMA(closedH1.map(c => c.close), 34).pop();
        const ema89H1Val = calculateEMA(closedH1.map(c => c.close), 89).pop();
        const ema34H4Val = calculateEMA(closedH4.map(c => c.close), 34).pop();
        const ema89H4Val = calculateEMA(closedH4.map(c => c.close), 89).pop();

        const ema34H1 = ema34H1Val ? +ema34H1Val.toFixed(3) : null;
        const ema89H1 = ema89H1Val ? +ema89H1Val.toFixed(3) : null;
        const ema34H4 = ema34H4Val ? +ema34H4Val.toFixed(3) : null;
        const ema89H4 = ema89H4Val ? +ema89H4Val.toFixed(3) : null;

        const distToEma89H1Pct = (ema89H1 && curPrice) ? +(((curPrice - ema89H1) / curPrice) * 100).toFixed(2) : null;
        const distToEma34H4Pct = (ema34H4 && curPrice) ? +(((curPrice - ema34H4) / curPrice) * 100).toFixed(2) : null;

        // Nến M15 & FVGs
        const last5M15 = closedM15.slice(-5).map(c => ({
          time: new Date(c.ts).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          isBullish: c.close >= c.open,
          bodyRange: +(Math.abs(c.close - c.open)).toFixed(3)
        }));

        const fvgsM15 = findFairValueGaps(closedM15).slice(-5).map(f => ({
          type: f.type,
          top: +f.top.toFixed(3),
          bottom: +f.bottom.toFixed(3),
          size: +f.size.toFixed(3),
          isMitigated: f.isMitigated
        }));

        // Macro Range Box & Radar
        const macroBox = detectMacroRangeBox(closedH4);
        const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice, candlesH1: closedH1, candlesD1: closedD1, candlesW1: closedW1 });
        const effectiveCfg = getEffectiveConfig();

        return {
          symbol: sym,
          giaHienTai: curPrice,
          adxH1: curAdx,
          chopSleepMode: isChopSleep
            ? 'ĐANG KÍCH HOẠT (ADX H1 <= 20: Thị trường nén sideway không xu hướng, mọi breakout/breakdown M15 đều có rủi ro fakeout cực cao)'
            : 'BÌNH THƯỜNG (Có xu hướng)',
          canDongSupportH1_H4: {
            ema34H1,
            ema89H1,
            distToEma89H1Pct: distToEma89H1Pct !== null ? `${distToEma89H1Pct}%` : 'N/A',
            ema34H4,
            ema89H4,
            distToEma34H4Pct: distToEma34H4Pct !== null ? `${distToEma34H4Pct}%` : 'N/A',
            canhBaoCanDong: (distToEma89H1Pct !== null && distToEma89H1Pct > 0 && distToEma89H1Pct < 3.0)
              ? `Giá đang rơi sát ngay Hỗ Trợ Động H1 EMA89 (${ema89H1}) - Đè Short tại đây là bán ngay đáy hỗ trợ, RR cực tệ!`
              : null
          },
          nếnM15GanNhat: last5M15,
          khoangTrongGiaFVG_M15: fvgsM15,
          hopViMoMacroRangeBox: macroBox ? {
            rangeHigh: macroBox.rangeHigh,
            rangeLow: macroBox.rangeLow,
            equilibrium: macroBox.equilibrium,
            viTriHienTai: curPrice > macroBox.equilibrium ? `Nửa trên hộp (Gần Range High ${macroBox.rangeHigh})` : `Nửa dưới hộp (Gần Range Low ${macroBox.rangeLow})`,
            khoangCachToiTranHop: `${+(((macroBox.rangeHigh - curPrice) / curPrice) * 100).toFixed(2)}%`,
            khoangCachToiSanHop: `${+(((curPrice - macroBox.rangeLow) / curPrice) * 100).toFixed(2)}%`
          } : 'Chưa hình thành hộp đa tháng',
          keHoachLimitDonDau: radar?.limitPlan || null,
          radarKeyLevels: {
            trendH4: radar?.trendH4,
            nearestResistance: radar?.nearestRes,
            distToRes: radar?.distToResPct + '%',
            nearestSupport: radar?.nearestSup,
            distToSup: radar?.distToSupPct + '%',
            scenario: radar?.scenario
          },
          trangThaiChienLuocCuaHeThong: {
            chienLuocBreakdownM15: effectiveCfg.enableBreakoutStrategy
              ? 'BẬT'
              : 'ĐÃ CHỦ ĐỘNG TẮT (Lý do cốt lõi: Backtest 1 năm 6 coin cho thấy M15 Volume Breakdown lỗ -81R do dính bẫy fakeout trong thị trường crypto sideway)',
            chienLuocMacroRangeShort: 'ĐANG BẬT (Chỉ kích hoạt tại sát trần hộp vĩ mô, tuyệt đối không Short ở giữa hộp)',
            chienLuocKaneSonicR: 'ĐANG BẬT (Chờ nhịp Pullback về EMA34/89 kèm nến từ chối)',
            coCheEntryDelay: `${effectiveCfg.entryDelayBars || 4} nến M15 (~60 phút xác nhận sau khi có setup để chống fakeout)`
          }
        };
      } catch (err) {
        console.error(`[TELEGRAM BOT] Lỗi phân tích sâu ${sym}:`, err.message);
        return null;
      }
    });

    const [h4Snapshots, d1Context, w1Context, m15Recent, deepFocusSnapshots] = await Promise.all([
      Promise.all(h4Promises),
      d1Promise,
      w1Promise,
      m15Promise,
      Promise.all(focusPromises)
    ]);

    const validSnapshots = h4Snapshots.filter(Boolean);
    const validDeepSnapshots = deepFocusSnapshots.filter(Boolean);

    const marketCtx = JSON.stringify({
      chiTietChuyenSauCoinDuocHoi: validDeepSnapshots,
      top6RadarH4: validSnapshots,
      btcVĩMôW1_KhungTuần: w1Context,
      btcVĩMôD1_KhungNgay: d1Context,
      btcPriceActionM15: m15Recent,
      viThePaperTradeDangMo: positions && positions.length > 0
        ? positions.map(p => ({ symbol: p.symbol, direction: p.direction, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit, isProfitLocked: p.isProfitLocked }))
        : 'Không có vị thế nào đang mở',
      tinHieuDangChoXacNhan: pendingSignals && pendingSignals.length > 0
        ? pendingSignals.map(p => ({ symbol: p.symbol, direction: p.signal.direction, entryDuKien: p.signal.entry, phatHienLucNao: new Date(p.detectedAt).toISOString(), ghiChu: 'Bot ENTRY DELAY: đã đạt chuẩn setup nhưng đang chờ thêm thời gian xác nhận trước khi vào lệnh thật, tránh fakeout' }))
        : 'Không có tín hiệu nào đang chờ xác nhận'
    }, null, 2);

    const kbContext = loadKnowledgeBase();

    const historyText = chatHistory.length > 0
      ? chatHistory.map(h => `Người dùng: ${h.query}\nBạn đã trả lời: ${h.reply.replace(/<[^>]*>?/gm, '')}`).join('\n\n')
      : 'Chưa có lịch sử, đây là câu hỏi đầu tiên trong phiên chat.';

    const prompt = `Lịch sử hội thoại gần đây trong phiên chat này (để nhớ mạch, không lặp lại hay mâu thuẫn với câu trả lời trước):
${historyText}

Người dùng vừa hỏi tiếp: "${query}"

Dữ liệu thị trường thời gian thực quét trực tiếp từ sàn OKX:
${marketCtx}

Tài liệu chiến lược & bài học thực chiến của chính hệ thống (dùng để trả lời đúng theo cách bot THẬT đang vận hành, không phải lý thuyết chung chung):
${kbContext}`;

    const systemInstruction = `Bạn là Antigravity Quant Trader — Bộ Não AI của hệ thống Trading Tự động (Victor Trading Bot) trên sàn OKX.
Bạn sở hữu năng lực phân tích định lượng, SMC (Smart Money Concepts), Wyckoff và Kane Sonic R (EMAs 34/89) ngang tầm chuyên gia Quant cấp cao.
TƯ DUY CỦA BẠN ĐỒNG NHẤT 100% VỚI BỘ NÃO ANTIGRAVITY: SẮC BÉN, DỰA VÀO DỮ LIỆU ĐỊNH LƯỢNG THỰC TẾ TRÊN SÀN OKX, BẢO TOÀN VỐN LÀ SỐ 1, KHÔNG BAO BIỆN CHUNG CHUNG, LUÔN DẪN CHỨNG CÁC CON SỐ THỰC TẾ.

BỘ NGUYÊN TẮC KỶ LUẬT THÉP VÀ LOGIC VẬN HÀNH:
1. TẠI SAO KHÔNG SHORT KHI THẤY NẾN ĐỎ VỠ FVG / THỦNG NỀN M15 (Ví dụ điển hình như HYPE)?
   - Backtest 1 năm 6 coin: Đuổi theo M15 Breakdown nộp mạng -81R cho sàn do liên tục dính fakeout quét 2 đầu. Hệ thống đã CHỦ ĐỘNG TẮT chiến lược M15 Breakdown.
   - Chỉ số ADX H1 & Chop Sleep Mode: Khi ADX H1 <= 20 (ví dụ HYPE ADX 14.x), thị trường rơi vào pha sideway nén, không có trend, nến thọc lủng FVG phần lớn là bẫy thanh khoản (Liquidity Sweep) của Market Maker để kích hoạt Stop Loss đám đông rồi đảo chiều.
   - Cản động hỗ trợ tổ chức (H1 EMA89 & H4 EMA34): Nếu giá đang lao thẳng vào vùng hỗ trợ động hoặc trục giữa (Equilibrium) của hộp vĩ mô, khoảng trống giảm (Reward) chỉ còn 1-2 USD trong khi SL phải đặt xa 3-4 USD -> Risk:Reward < 1:1 (cực kỳ tệ hại). Đè Short ở đây là bán ngay đáy hỗ trợ lớn!
   - Không Short ở "Chợ Giữa" (Mid-Range): Trong hộp vĩ mô (Macro Range Box), vùng giữa hộp là vùng nhiễu (Chop Zone). Smart Money chỉ rình Short tại TRẦN HỘP (Range High) hoặc gom Long tại SÀN HỘP (Range Low).

2. TƯ DUY ALPHA COIN vs BETA COIN & LỆNH LIMIT ĐÓN ĐẦU:
   - Các coin như HYPE là Alpha Coin (dòng tiền độc lập, không nhất thiết chạy theo BTC).
   - Với Alpha Coin dao động trong Hộp Vĩ Mô đa tháng (như HYPE [75.15 - 97.06]): Bot có kế hoạch LIMIT ĐÓN ĐẦU (Limit Plan) tại sát 2 biên hộp (Short Limit gần 96.6, Long Limit gần 75.5) với Risk:Reward vượt trội (1:9+).
   - Tuyệt đối không FOMO vào lệnh Market giữa chừng khi giá đang lơ lửng ở 88-89.

3. CƠ CHẾ ENTRY DELAY BẢO VỆ VỐN:
   - Khi có setup hợp lệ, hệ thống luôn đưa vào hàng đợi chờ xác nhận (Entry Delay 4 nến M15 = ~60 phút) để lọc bỏ 100% nến rút râu ảo.

4. CÁCH TRÌNH BÀY CÂU TRẢ LỜI:
   - BẮT BUỘC DÙNG ĐỊNH DẠNG HTML TELEGRAM (<b>in đậm</b>, <code>mã/số</code>, <i>in nghiêng</i>). TUYỆT ĐỐI KHÔNG DÙNG markdown **.
   - Trả lời trực diện, thuyết phục, bóc tách cụ thể từng con số thực tế có trong dữ liệu:
     * Nêu rõ giá hiện tại, chỉ số ADX H1, các mốc FVG M15 vừa hình thành.
     * Nêu rõ vị trí H1 EMA89, H4 EMA34, và vị trí trong Hộp Vĩ Mô [Range Low - Range High].
     * Chỉ rõ lý do bot không báo Short (hoặc Long), và đưa ra kịch bản chuẩn Quant (chờ hồi về đâu, hoặc Limit đón đầu ở mốc nào).
   - Giọng điệu chuyên nghiệp, quyết đoán, truyền cảm hứng kỷ luật giao dịch.`;

    const answer = await callGemini(prompt, systemInstruction);
    chatHistory.push({ query, reply: answer });
    if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
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

  // Tự động đồng bộ Menu lệnh chuẩn 5 mục chính (loại bỏ danh sách coin rác làm ngập menu)
  try {
    const commands = [
      { command: 'status', description: '📊 Trạng thái Bot & Vị thế đang mở' },
      { command: 'radar', description: '🧭 Bản đồ cản đón đầu Top Coin' },
      { command: 'soi', description: '🔍 Soi cản & kịch bản coin (VD: /soi eth)' },
      { command: 'pnl', description: '💰 Hiệu suất & Lợi nhuận Paper Trade' },
      { command: 'help', description: '💡 Hướng dẫn & Hỏi đáp AI Gemini' }
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

📌 <b>MENU LỆNH CHÍNH (Gõ có hoặc không có dấu / đều được):</b>
• <code>/status</code>: Kiểm tra trạng thái bot, kết nối sàn OKX và vị thế đang mở.
• <code>/radar</code>: Bản Đồ Cản Canh Trước (Đón đầu tại cản cứng) Top Premier Coins.
• <code>/soi [mã coin]</code>: Soi đa khung thời gian & cản cứng (VD: <code>/soi btc</code>, <code>/soi eth</code>, <code>/soi hype</code>).
• <code>/pnl</code>: Thống kê hiệu suất, tỉ lệ thắng & lợi nhuận ròng.
• <code>/help</code>: Hướng dẫn sử dụng & kết nối AI.

💡 <b>TÍNH NĂNG THÔNG MINH BỔ SUNG:</b>
• 💬 <b>Hỏi đáp tự nhiên:</b> Nhắn bất kỳ câu hỏi nào bằng tiếng Việt, Gemini sẽ trả lời kèm dữ liệu thị trường live!
• 📸 <b>Gửi ảnh biểu đồ:</b> Gửi ảnh chụp chart TradingView/OKX vào đây, Gemini Vision sẽ tự động đọc nến & vạch kịch bản!
• ⚡ <b>Phím tắt nhanh:</b> Gõ trực tiếp <code>/btc</code>, <code>/eth</code>, <code>/sol</code>, <code>/link</code>, <code>/near</code>, <code>/hype</code> để soi nhanh.
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
                  reply += `  • <b>${pos.symbol}</b> ${pos.direction} (Entry: ${formatPrice(pos.entry)}, SL: ${formatPrice(pos.stopLoss)}, TP: ${formatPrice(pos.takeProfit)})\n`;
                }
              } else {
                reply += `📊 <b>Vị thế đang mở:</b> <code>0/2 (Đang rình setup A+)</code>\n`;
              }

              const getPendingFn = context.getPendingSignals;
              const pending = typeof getPendingFn === 'function' ? getPendingFn() : [];
              if (pending && pending.length > 0) {
                reply += `\n⏳ <b>ĐANG CHỜ XÁC NHẬN (Entry Delay, ${pending.length}):</b>\n`;
                for (const p of pending) {
                  const waitedMin = Math.round((Date.now() - p.detectedAt) / 60000);
                  reply += `  • <b>${p.symbol}</b> ${p.signal.direction} (phát hiện ${waitedMin} phút trước, entry dự kiến ~${formatPrice(p.signal.entry)})\n`;
                }
              }

              try {
                const { getNextNewsEvent, isNewsBlackout } = await import('./news_calendar.js');
                const nowMs = Date.now();
                const curNews = isNewsBlackout(nowMs, parseFloat(process.env.NEWS_BLACKOUT_HOURS || '2'));
                if (curNews.blocked) {
                  reply += `\n⏸️ <b>ĐANG TẠM DỪNG VÀO LỆNH:</b> <code>Gần tin ${curNews.event}</code>\n`;
                }
                const nextNews = getNextNewsEvent(nowMs);
                if (nextNews) {
                  const t = new Date(nextNews.tsMs).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                  reply += `\n📰 <b>Tin lớn kế tiếp:</b> <code>${nextNews.name}</code> (còn ${nextNews.hoursAway.toFixed(1)}h, lúc ${t})\n`;
                }
              } catch {}

              reply += `\n💡 <i>Gõ /radar để xem khoảng cách tới các cản gần nhất.</i>`;
              await sendTelegramMessage(reply);
            } else if (
              ['canh', 'radar', 'plan', 'keo', 'kèo', 'kịch bản', 'kich ban', 'bản đồ', 'ban do'].some(k => cleanText === k || cleanText.startsWith(k))
            ) {
              const report = await handleRadarCommand(fetchOkxCandles);
              await sendTelegramMessage(report);
            } else if (
              ['pnl', 'profit', 'lợi nhuận', 'loi nhuan', 'hiệu suất', 'hieu suat'].some(k => cleanText === k || cleanText.startsWith(k))
            ) {
              let history = [];
              try {
                const fs = await import('fs');
                const path = await import('path');
                const histFile = path.resolve('data/trade_history.json');
                if (fs.existsSync(histFile)) {
                  history = JSON.parse(fs.readFileSync(histFile, 'utf8'));
                }
              } catch {}

              let reply = `💰 <b>BÁO CÁO HIỆU SUẤT GIAO DỊCH (PNL)</b>\n`;
              reply += `━━━━━━━━━━━━━━━━━━━━\n`;
              if (history && history.length > 0) {
                const totalTrades = history.length;
                const wins = history.filter(t => (t.pnlR || 0) > 0.1).length;
                const losses = history.filter(t => (t.pnlR || 0) < -0.1).length;
                const bes = totalTrades - wins - losses;
                const winRate = ((wins / totalTrades) * 100).toFixed(1);
                const netR = history.reduce((sum, t) => sum + (t.pnlR || 0), 0);
                const netUsd = history.reduce((sum, t) => sum + (t.netPnlUsd || 0), 0);
                const rSign = netR >= 0 ? '+' : '';
                const usdSign = netUsd >= 0 ? '+' : '';

                reply += `📊 <b>Tổng lệnh đã đóng:</b> <code>${totalTrades}</code>\n`;
                reply += `🟢 <b>Thắng:</b> <code>${wins}</code> | 🔴 <b>Thua:</b> <code>${losses}</code> | 🛡️ <b>Hòa/BE:</b> <code>${bes}</code>\n`;
                reply += `🎯 <b>Tỉ lệ thắng:</b> <code>${winRate}%</code>\n`;
                reply += `💵 <b>Lợi nhuận ròng R:</b> <b>${rSign}${netR.toFixed(2)}R</b>\n`;
                reply += `💲 <b>Lợi nhuận USDT:</b> <b>${usdSign}$${netUsd.toFixed(2)}</b>\n`;
              } else {
                reply += `📊 <b>Phiên Live hiện tại:</b> Chưa có lệnh nào đóng.\n`;
                reply += `🛡️ Hệ thống duy trì kỷ luật thép (Chỉ vào setup điểm A+).\n\n`;
                reply += `📈 <b>HIỆU SUẤT KỊCH BẢN BACKTEST 1 NĂM (2025 - 2026):</b>\n`;
                reply += `• <b>Tổng số lệnh:</b> <code>125</code>\n`;
                reply += `• <b>Số lệnh SL đã triệt tiêu:</b> <code>94 ➔ 45 lệnh (-52% rủi ro)</code>\n`;
                reply += `• <b>Tỉ lệ thắng (Win Rate):</b> <code>54.2%</code>\n`;
                reply += `• <b>Lợi nhuận ròng:</b> <b>+27.8R</b> (BTC: +5.87R, ETH: +16.27R, LINK: +8.59R)\n`;
                reply += `• <b>Profit Factor:</b> <code>1.49</code> | <b>Max Drawdown:</b> <code>-11.67R</code>\n`;
              }
              const getPositionsFn = context.getActivePositions;
              const curPositions = typeof getPositionsFn === 'function' ? getPositionsFn() : [];
              reply += `\n💎 <b>Vị thế đang mở:</b> <code>${curPositions.length}/2</code>`;
              await sendTelegramMessage(reply);
            } else if (cleanText === 'soi') {
              const reply = `
🔍 <b>HƯỚNG DẪN SOI CẢN VÀ KỊCH BẢN COIN</b>
━━━━━━━━━━━━━━━━━━━━
Cú pháp: <code>/soi [mã coin]</code>
Ví dụ:
• <code>/soi btc</code> - Soi Bitcoin
• <code>/soi eth</code> - Soi Ethereum
• <code>/soi sol</code> - Soi Solana
• <code>/soi link</code> - Soi Chainlink
• <code>/soi near</code> - Soi Near Protocol
• <code>/soi hype</code> - Soi Hyperliquid

<i>💡 Mẹo: Bạn cũng có thể gõ tắt trực tiếp <code>/btc</code>, <code>/eth</code>, <code>/hype</code>... đều được hỗ trợ!</i>
              `.trim();
              await sendTelegramMessage(reply);
            } else if (
              cleanText.startsWith('soi ') ||
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
              const candlesH4 = await fetchOkxCandles(instId, '4H', 300);
              if (candlesH4 && candlesH4.length >= 20) {
                const closedH4 = candlesH4.filter(c => c.confirm === 1);
                const curPrice = closedH4[closedH4.length - 1].close;
                const radar = generateKeyLevelRadar({ symbol: sym, candlesH4: closedH4, curPrice });
                if (radar) {
                  const reply = `
🔍 <b>PHÂN TÍCH NHANH: ${sym}</b>
━━━━━━━━━━━━━━━━━━━━
💵 <b>Giá hiện tại:</b> <code>${formatPrice(curPrice)}</code>
📈 <b>Xu hướng H4 (EMA34/89):</b> ${radar.trendH4 === 'BULL' ? '🟢 TĂNG' : '🔴 GIẢM'}
🔺 <b>Cản gần nhất:</b> <code>${formatPrice(radar.nearestRes)}</code> (${radar.distToResPct !== null ? '+' + radar.distToResPct + '%' : ''})
🔻 <b>Hỗ trợ gần nhất:</b> <code>${formatPrice(radar.nearestSup)}</code> (${radar.distToSupPct !== null ? '-' + radar.distToSupPct + '%' : ''})
🎯 <b>Kịch bản:</b> ${radar.scenario}
                  `.trim();
                  await sendTelegramMessage(reply);
                }
              }
            } else if (rawText.length > 0) {
              // Bất kỳ câu hỏi / tin nhắn tự do nào khác -> Gemini 3.8 Flash trả lời thông minh
              const getPositionsFn2 = context.getActivePositions;
              const curPositions = typeof getPositionsFn2 === 'function' ? getPositionsFn2() : [];
              const getPendingFn2 = context.getPendingSignals;
              const curPending = typeof getPendingFn2 === 'function' ? getPendingFn2() : [];
              const reply = await handleGeneralChatQuery(rawText, fetchOkxCandles, curPositions, curPending);
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

