// Runs once when the Next.js server starts (on Railway: the always-on web service).
// Every 5 minutes: push new 4h signals; ~1h before each 4h close: push the list of setups to watch.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert } = await import("./lib/telegram-alerts");
  const tick = async () => {
    await scanAndAlert().catch((e) => console.error("telegram alerts", e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000);
}
