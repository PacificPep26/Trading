// Runs once when the Next.js server starts (on Railway: the always-on web service).
// Scans the 4h rule every 5 minutes and pushes new signals to Telegram.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert } = await import("./lib/telegram-alerts");
  const tick = () => scanAndAlert().catch((e) => console.error("telegram alerts", e));
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000);
}
