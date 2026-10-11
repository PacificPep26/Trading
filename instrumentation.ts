// Runs once when the Next.js server starts (on Railway: the always-on web service).
// Every 2 minutes: push new 4h signals, radar tiệm cận đỉnh/đáy, và báo trước nến 4h đóng ~5p.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert, preAlert, proximityRadarAlert } = await import("./lib/telegram-alerts");
  const tick = async () => {
    await scanAndAlert().catch((e) => console.error("telegram alerts", e));
    await preAlert().catch((e) => console.error("telegram preAlert", e));
    await proximityRadarAlert().catch((e) => console.error("telegram radar", e));
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 2 * 60_000);
}
