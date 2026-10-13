// Runs once when the Next.js server starts (on Railway: the always-on web service).
// Quét mỗi 2 phút: Tự động vào lệnh và chỉ báo khi có vị thế thật, khớp TP/SL, hoặc trước nến 4h đóng.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert, preAlert } = await import("./lib/telegram-alerts");
  let busy = false; // lượt quét chậm > 2 phút không được chồng lượt sau (tránh vào lệnh 2 lần)
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await scanAndAlert().catch((e) => console.error("telegram alerts", e));
      await preAlert().catch((e) => console.error("telegram preAlert", e));
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 2 * 60_000);
}
