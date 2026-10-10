import { getMexcAccountAsset } from "@/lib/mexc-client";

export const runtime = "nodejs";

export async function GET() {
  const asset = await getMexcAccountAsset(40);
  return Response.json({
    asset,
    env: {
      hasKey: Boolean(process.env.MEXC_API_KEY),
      hasSecret: Boolean(process.env.MEXC_SECRET_KEY),
      dryRun: process.env.MEXC_DRY_RUN,
    }
  });
}

