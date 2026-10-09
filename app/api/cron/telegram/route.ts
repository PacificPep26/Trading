// Manual trigger / health check for the Telegram alerts (the server already scans every 5 minutes).
// Requires ?secret=CRON_SECRET so strangers cannot spam the chat.
import { scanAndAlert, send } from "@/lib/telegram-alerts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  if (!secret || url.searchParams.get("secret") !== secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sent = await scanAndAlert();
    if (url.searchParams.get("test") === "1") await send(`✅ Bot hoạt động. Quét xong: ${sent.length} tín hiệu mới.`);
    return Response.json({ status: "ok", sent: sent.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
