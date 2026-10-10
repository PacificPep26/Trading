// Runs once when the Next.js server starts (on Railway: the always-on web service).
// Every 5 minutes: heads-up before each 4h close (preAlert self-gates to 1–7 min before close),
// trade/paper signals (scanAndAlert), then the near-high/low radar (2h cooldown per level).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.TELEGRAM_BOT_TOKEN) return;
  const { scanAndAlert, preAlert, proximityRadarAlert } = await import("./lib/telegram-alerts");
  const tick = async () => {
    await preAlert().catch((e) => console.error("telegram preAlert", e));
    await scanAndAlert().catch((e) => console.error("telegram alerts", e));
    await proximityRadarAlert().catch((e) => console.error("telegram radar", e));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000);
}
