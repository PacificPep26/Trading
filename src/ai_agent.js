/**
 * AI_AGENT.JS
 * Autonomous AI Market Researcher & Self-Learning Engine powered by Gemini 3.8 Flash.
 * 
 * Khả năng cốt lõi:
 * 1. Phân tích thị trường chuyên sâu dựa trên Smart Money Concept (SMC) & Kane Sonic R.
 * 2. Nhận diện bẫy thanh khoản (Inducement / EQH / EQL) và lập Bản đồ Thanh khoản hàng ngày.
 * 3. Tự động rút trích bài học thực chiến (Case Studies) từ các cú fakeout để nạp vào Knowledge Base.
 * 4. Phát báo cáo phân tích Telegram tự động cho người dùng.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '../data/knowledge_base');
const CASES_FILE = path.join(KNOWLEDGE_DIR, 'cases.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODELS = [PRIMARY_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest'];

/**
 * Đọc toàn bộ tri thức trading từ Knowledge Base
 */
export function loadKnowledgeBase() {
  let context = '';
  try {
    if (fs.existsSync(KNOWLEDGE_DIR)) {
      const files = fs.readdirSync(KNOWLEDGE_DIR);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
          context += `\n--- [TÀI LIỆU: ${file}] ---\n${content}\n`;
        }
      }
    }
    if (fs.existsSync(CASES_FILE)) {
      const cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
      context += `\n--- [CÁC TÌNH HUỐNG THỰC CHIẾN ĐÃ HỌC (CASE STUDIES)] ---\n${JSON.stringify(cases, null, 2)}\n`;
    }
  } catch (err) {
    console.warn('[AI AGENT] Lỗi nạp Knowledge Base:', err.message);
  }
  return context;
}

/**
 * Gửi yêu cầu tới Google Gemini API với cơ chế tự động fallback model
 * @param {string} prompt 
 * @param {string} systemInstruction 
 * @returns {Promise<string>}
 */
export async function callGemini(prompt, systemInstruction = '') {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY chưa được thiết lập trong file .env');
  }

  let lastError = null;

  for (const model of FALLBACK_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status} (${model}): ${errText}`);
      }

      const data = await res.json();
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error(`Phản hồi Gemini rỗng hoặc không đúng định dạng (${model})`);
    } catch (err) {
      lastError = err;
      console.warn(`[AI AGENT] Thử model ${model} thất bại: ${err.message}. Chuyển model dự phòng...`);
    }
  }

  throw new Error(`Tất cả các model Gemini đều thất bại. Lỗi cuối: ${lastError?.message}`);
}

/**
 * Sinh Bản Tin Phân Tích Thị Trường & Smart Money Hàng Ngày
 * @param {object} params
 * @returns {Promise<string>}
 */
export async function generateDailyMarketAnalysis({ symbolsData = [], activePositions = [] }) {
  const kbContext = loadKnowledgeBase();

  const systemPrompt = `
Bạn là "Antigravity Quant AI" - Chuyên gia Định lượng Cấp cao và Chuyên gia Smart Money Concepts (SMC) & Kane Sonic R (Fibonacci EMAs 34/89).
Nhiệm vụ của bạn là phân tích hành vi của Tạo lập thị trường (Market Maker / Smart Money), phát hiện các vùng bẫy thanh khoản (Inducement / Equal Highs / Equal Lows) nơi Retail trader thường bị bẫy, và đưa ra khuyến nghị chiến lược chính xác.

NGUYÊN TẮC PHÂN TÍCH:
1. KHÔNG PHÂN TÍCH SÁCH VỞ CẢM TÍNH. Mọi nhận định phải dựa trên cấu trúc giá H4, dải EMA 34/89, và 2 Tầng Thanh Khoản:
   - Tier 1: Inducement (Cản con / Bẫy thanh khoản): Nơi retail gom Stop Loss. Thường xuyên bị quét râu (Sweep).
   - Tier 2: Major Key Level (Cản lớn cấu trúc): Vùng cá mập hành động thật sự sau khi đã quét qua cản con.
2. Ngôn từ súc tích, chuyên nghiệp, tiếng Việt chuẩn mực, tôn trọng tư duy sắc bén của Pro Trader.
3. Định dạng bài viết trực quan, phù hợp gửi qua Telegram (dùng icon sinh động, chữ in đậm <b>...</b>, code <code>...</code>).
`.trim();

  const userPrompt = `
Dưới đây là Cẩm nang Nguyên lý của Hệ thống:
${kbContext}

Dưới đây là Dữ liệu Kỹ thuật Real-time quét từ OKX Futures (Khung H4):
${JSON.stringify(symbolsData, null, 2)}

Trạng thái Vị thế Hiện tại:
${JSON.stringify(activePositions, null, 2)}

HÃY SOẠN BẢN TIN: "BẢN TIN SMART MONEY & PHÂN TÍCH THANH KHOẢN HÀNG NGÀY" GỒM CÁC MỤC:
1. 🧠 **TỔNG QUAN TÂM LÝ & DÒNG TIỀN (MACRO FLOW)**: BTC & Market đang ở pha tích lũy, quét râu, hay bứt phá? EMA 34/89 đang dốc lên hay xuống?
2. 🗺️ **BẢN ĐỒ THANH KHOẢN (LIQUIDITY MAP)**:
   - Chỉ rõ đâu là vùng Cản Con (Inducement / Retail Trap) đám đông đang bị dụ Short/Long.
   - Chỉ rõ đâu là Cản Lớn Cấu Trúc (Whale Zones) mà cá mập đang chờ đón lõng.
3. 🎯 **KẾ HOẠCH HÀNH ĐỘNG 24H**:
   - Cặp coin tiềm năng nhất có tín hiệu Liquidity Sweep hoặc hồi quy EMA 34.
   - Các mức giá cần lưu ý (Key Levels).
4. ⚠️ **CẢNH BÁO NGUY HIỂM (INDUCEMENT ALERT)**: Nhắc nhở kỷ luật để không ai bị dính cú bơm quét SL lúc 19h như bài học ngày 21/10.

Định dạng Telegram HTML sạch sẽ, không dùng thẻ markdown \`\`\` trong văn bản chính, dùng thẻ <b> và <code>.
`.trim();

  return await callGemini(userPrompt, systemPrompt);
}

/**
 * Tự động trích xuất bài học thực chiến (Case Study) và lưu vào Knowledge Base
 * @param {object} caseData
 */
export async function extractAndSaveCaseStudy(caseData) {
  const { symbol, eventType, candlesH4, description, pnl } = caseData;

  const prompt = `
Dưới đây là một tình huống thị trường vừa diễn ra:
- Symbol: ${symbol}
- Loại sự kiện: ${eventType}
- Mô tả: ${description}
- Kết quả PnL: ${pnl || 'N/A'}
- 10 nến H4 gần nhất: ${JSON.stringify(candlesH4?.slice(-10) || [])}

Hãy phân tích ngắn gọn dưới góc độ Smart Money Concepts:
1. Retail Behavior: Đám đông đã nghĩ gì và hành động sai ở đâu?
2. Smart Money Action: Cá mập / Market Maker đã thao túng thanh khoản như thế nào?
3. System Lesson: Bài học kinh nghiệm định lượng cho bot để lần sau né bẫy hoặc kiếm tiền từ cú quét này?

Trả về kết quả dưới dạng JSON hợp lệ duy nhất có cấu trúc:
{
  "id": "CASE-${Date.now()}-${symbol}",
  "date": "${new Date().toISOString().split('T')[0]}",
  "symbol": "${symbol}",
  "eventType": "${eventType}",
  "description": "...",
  "retailBehavior": "...",
  "smartMoneyAction": "...",
  "systemLesson": "..."
}
Chỉ trả về JSON thuần, không bọc trong markdown.
`.trim();

  try {
    const response = await callGemini(prompt);
    const cleaned = response.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const caseObj = JSON.parse(cleaned);

    let cases = [];
    if (fs.existsSync(CASES_FILE)) {
      try {
        cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
      } catch {
        cases = [];
      }
    }
    cases.push(caseObj);
    fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2), 'utf8');
    console.log(`[AI AGENT] Đã lưu Case Study mới vào Knowledge Base: ${caseObj.id}`);
    return caseObj;
  } catch (err) {
    console.error('[AI AGENT] Lỗi trích xuất Case Study:', err.message);
    return null;
  }
}

