import { randomUUID } from "crypto";
import { db, ensurePositionsTable } from "@/lib/db";

export const runtime = "nodejs";

const INSTRUMENTS = new Set(["SOL-USDT-SWAP", "BTC-USDT-SWAP", "ETH-USDT-SWAP", "HYPE-USDT-SWAP"]);

function validNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function GET() {
  try {
    await ensurePositionsTable();
    const { rows } = await db().query("SELECT * FROM trading_positions ORDER BY status ASC, opened_at DESC LIMIT 50");
    return Response.json({ positions: rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không đọc được vị thế" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!INSTRUMENTS.has(body.instId) || !["long", "short"].includes(body.side) ||
        ![body.entry, body.tp, body.sl, body.margin, body.leverage].every(validNumber)) {
      return Response.json({ error: "Dữ liệu vị thế không hợp lệ" }, { status: 422 });
    }
    if ((body.side === "long" && !(body.sl < body.entry && body.tp > body.entry)) ||
        (body.side === "short" && !(body.tp < body.entry && body.sl > body.entry))) {
      return Response.json({ error: "TP/SL không đúng hướng của lệnh" }, { status: 422 });
    }
    await ensurePositionsTable();
    const id = randomUUID();
    const { rows } = await db().query(
      `INSERT INTO trading_positions (id, inst_id, side, entry, tp, sl, margin, leverage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, body.instId, body.side, body.entry, body.tp, body.sl, body.margin, body.leverage],
    );
    return Response.json({ position: rows[0] }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không lưu được vị thế" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !["open", "closed"].includes(body.status)) {
      return Response.json({ error: "Yêu cầu cập nhật không hợp lệ" }, { status: 422 });
    }
    await ensurePositionsTable();
    const { rows } = await db().query(
      `UPDATE trading_positions SET status=$2, closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END,
       updated_at=now() WHERE id=$1 RETURNING *`, [body.id, body.status],
    );
    if (!rows[0]) return Response.json({ error: "Không tìm thấy vị thế" }, { status: 404 });
    return Response.json({ position: rows[0] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không cập nhật được vị thế" }, { status: 503 });
  }
}
