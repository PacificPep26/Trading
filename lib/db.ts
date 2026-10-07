import { Pool } from "pg";

declare global {
  var tradingPool: Pool | undefined;
}

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình");
  if (!global.tradingPool) {
    global.tradingPool = new Pool({ connectionString: url });
  }
  return global.tradingPool;
}

export async function ensurePositionsTable() {
  await db().query(`
    CREATE TABLE IF NOT EXISTS trading_positions (
      id uuid PRIMARY KEY,
      inst_id text NOT NULL,
      side text NOT NULL CHECK (side IN ('long', 'short')),
      entry double precision NOT NULL CHECK (entry > 0),
      tp double precision NOT NULL CHECK (tp > 0),
      sl double precision NOT NULL CHECK (sl > 0),
      margin double precision NOT NULL CHECK (margin > 0),
      leverage double precision NOT NULL CHECK (leverage > 0),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
