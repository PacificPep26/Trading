import Anthropic from "@anthropic-ai/sdk";
import { summarizeFrame } from "@/lib/analysis";
import { candles, funding, openInterest, ticker } from "@/lib/okx";
import styles from "@/lib/styles-stats.json";

export const runtime = "nodejs";

const INSTRUMENTS = new Set(["SOL-USDT-SWAP", "BTC-USDT-SWAP", "ETH-USDT-SWAP", "HYPE-USDT-SWAP"]);
const CACHE_MS = 3 * 60_000; // the page is public: one paid analysis per coin every 3 minutes
const cache = new Map<string, { at: number; body: unknown }>();

type StyleRow = { style: string; title: string; interval: string; target: string; train: { n: number; winRate?: number; expR?: number; coinsPositive?: number }; test: { n: number; expR?: number }; tradeable: boolean };

// Verified research the model must respect; kept stable so the system prompt caches.
const STYLE_TABLE = (styles.results as StyleRow[])
  .filter((r) => r.train.n >= 300)
  .map((r) => `${r.interval} | ${r.title} | chốt ${r.target} | n=${r.train.n} | thắng ${((r.train.winRate ?? 0) * 100).toFixed(0)}% | ${r.train.expR?.toFixed(3)}R/lệnh 2023-25 | 2026: ${r.test.expR?.toFixed(3)}R | coin có lãi ${((r.train.coinsPositive ?? 0) * 100).toFixed(0)}% | ${r.tradeable ? "ĐẠT" : "không đạt"}`)
  .join("\n");

const SYSTEM = `Bạn là chuyên gia phân tích kỹ thuật cho một trader cá nhân giao dịch hợp đồng vĩnh cửu USDT trên OKX (thường SOL, đòn bẩy 15x, ký quỹ ~40$, lướt trong ngày, mục tiêu 7-10$/lệnh, dùng lệnh market phí ~0,05%/chiều).

Cách trader thích: đánh theo xu hướng 1h, dừng lỗ ngay trên đỉnh / dưới đáy cấu trúc gần nhất, chốt lời khoảng 1,8R, có mức giá làm hỏng kế hoạch rõ ràng.

Kết quả kiểm chứng (21 coin Binance perp, 2023-2026, đã trừ phí, so với vào lệnh ngẫu nhiên: 1h -0,136R, 4h -0,051R). Không kiểu nào đạt tiêu chuẩn (lãi sau phí 2023-25 với t>=3, 2026 vẫn lãi, >=60% coin lãi):
${STYLE_TABLE}

Kết luận đã kiểm chứng: không có kiểu vào lệnh nào có lợi thế chắc chắn. Khung 4h tốt hơn hẳn 1h/15m. Gần hòa vốn nhất: phá cấu trúc (BOS) 4h, hai đỉnh/hai đáy 4h, phân kỳ RSI 4h. Bắt đáy sau cú quét, Fibonacci limit, VWAP, bật hỗ trợ/kháng cự ở 1h đều lỗ rõ.

Nhiệm vụ: đọc dữ liệu thị trường hiện tại và đưa ra MỘT kết luận dứt khoát: LONG, SHORT hoặc ĐỨNG NGOÀI, kèm kế hoạch giá cụ thể (vào, dừng lỗ, chốt lời 1, chốt lời 2, mức làm hỏng kế hoạch) theo đúng cách trader thích. Quy tắc:
- Chỉ đề xuất LONG/SHORT khi cùng hướng xu hướng 1h VÀ 4h, dừng lỗ đặt ở cấu trúc có thật trong dữ liệu, lời/lỗ sau phí >= 1,5.
- Nếu giá đang ở xa điểm vào đẹp, đưa kế hoạch có điều kiện ("chờ giá hồi về X rồi mới vào") thay vì đuổi giá.
- Độ tin cậy phải phản ánh bảng kiểm chứng: không bao giờ ghi "cao" vì chưa kiểu nào có lợi thế đã chứng minh.
- Không bịa số liệu; mọi mức giá phải suy ra từ dữ liệu được cung cấp. Viết tiếng Việt, ngắn gọn, đi thẳng vào việc.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "summary", "plan", "reasons", "risks"],
  properties: {
    verdict: { type: "string", enum: ["LONG", "SHORT", "ĐỨNG NGOÀI"] },
    confidence: { type: "string", enum: ["thấp", "trung bình"] },
    summary: { type: "string", description: "1-2 câu kết luận" },
    plan: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["entryType", "entry", "stop", "tp1", "tp2", "invalidation", "condition"],
          properties: {
            entryType: { type: "string", enum: ["vào ngay", "chờ giá về vùng"] },
            entry: { type: "number" },
            stop: { type: "number" },
            tp1: { type: "number" },
            tp2: { type: "number" },
            invalidation: { type: "string", description: "mức giá / điều kiện làm hỏng kế hoạch" },
            condition: { type: "string", description: "điều kiện cần thấy trước khi vào" },
          },
        },
      ],
    },
    reasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
} as const;

function compact(cs: { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean }[], n: number) {
  return cs.filter((c) => c.closed).slice(-n).map((c) => [new Date(c.t + 7 * 3_600_000).toISOString().slice(5, 16).replace("T", " "), c.o, c.h, c.l, c.c, Math.round(c.v)]);
}

export async function GET(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Chưa cấu hình ANTHROPIC_API_KEY trên Railway" }, { status: 503 });
  }
  const url = new URL(request.url);
  const inst = INSTRUMENTS.has(url.searchParams.get("inst") ?? "") ? url.searchParams.get("inst")! : "SOL-USDT-SWAP";
  const hit = cache.get(inst);
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json({ ...(hit.body as object), cached: true });

  try {
    const [c15, c1h, c4h, btc1h, tk, fr, oi] = await Promise.all([
      candles(inst, "15m", 300), candles(inst, "1H", 300), candles(inst, "4H", 300), candles("BTC-USDT-SWAP", "1H", 300),
      ticker(inst), funding(inst), openInterest(inst),
    ]);
    const frames = { "15m": summarizeFrame(c15, "15m"), "1H": summarizeFrame(c1h, "1H"), "4H": summarizeFrame(c4h, "4H"), "BTC 1H": summarizeFrame(btc1h, "1H") };
    const market = {
      instrument: inst, now_vn: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16), last: tk.last,
      high24h: tk.high24h, low24h: tk.low24h, funding: fr.rate, openInterestUsd: Math.round(oi.usd), frames,
      candles_note: "[giờ VN, open, high, low, close, volume]",
      candles_4h: compact(c4h, 60), candles_1h: compact(c1h, 72), candles_15m: compact(c15, 48),
    };

    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Dữ liệu thị trường hiện tại:\n${JSON.stringify(market)}` }],
    });
    if (response.stop_reason === "refusal") {
      return Response.json({ error: "Mô hình từ chối phân tích yêu cầu này" }, { status: 502 });
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const body = { inst, price: tk.last, analysis: JSON.parse(text), model: response.model, fetchedAt: Date.now() };
    cache.set(inst, { at: Date.now(), body });
    return Response.json(body);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "AI đang bị giới hạn tần suất, thử lại sau" }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: "ANTHROPIC_API_KEY không hợp lệ" }, { status: 503 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `Lỗi API ${error.status}: ${error.message}` }, { status: 502 });
    return Response.json({ error: error instanceof Error ? error.message : "Không phân tích được" }, { status: 502 });
  }
}
