// Chạy 1 lần khi server Next.js khởi động (Railway web service): quét kèo mỗi 2 phút.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert } = await import("./lib/telegram-alerts");
  let busy = false; // lượt quét chậm > 2 phút không được chồng lượt sau (tránh báo trùng)
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await scanAndAlert().catch((e) => console.error("telegram alerts", e));
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 2 * 60_000);
}
