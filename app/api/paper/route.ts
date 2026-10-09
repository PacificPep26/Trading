import { paperSummary, readPaperEvents } from "@/lib/paper-ledger";

export const runtime = "nodejs";

export async function GET() {
  const equity = Number(process.env.ALERT_CAPITAL ?? 40);
  return Response.json({ summary: paperSummary(equity), events: readPaperEvents().slice(-200) });
}
