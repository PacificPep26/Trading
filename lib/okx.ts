// Public OKX market data (no API key). Server-side only.
const BASE = "https://www.okx.com/api/v5";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean };

async function get<T>(path: string, retries = 2): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.status === 429 && retries > 0) {
      await new Promise((r) => setTimeout(r, 600));
      return get<T>(path, retries - 1);
    }
    if (!res.ok) throw new Error(`OKX ${res.status} ${path}`);
    const body = (await res.json()) as { code: string; msg: string; data: T };
    if (body.code !== "0") throw new Error(`OKX ${body.code} ${body.msg}`);
    return body.data;
  } catch (err) {
    if (retries > 0 && String(err).includes("429")) {
      await new Promise((r) => setTimeout(r, 800));
      return get<T>(path, retries - 1);
    }
    throw err;
  }
}

export async function publicGet<T>(path: string): Promise<T> {
  return get<T>(path);
}

export async function candles(instId: string, bar: string, limit = 120): Promise<Candle[]> {
  const rows = await get<string[][]>(`/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
  // OKX returns newest first: [ts, o, h, l, c, vol(contracts), volCcy(coin), volQuote, confirm]
  return rows
    .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6], closed: r[8] === "1" }))
    .reverse();
}

export async function ticker(instId: string) {
  const [d] = await get<Record<string, string>[]>(`/market/ticker?instId=${instId}`);
  return { last: +d.last, open24h: +d.open24h, high24h: +d.high24h, low24h: +d.low24h, vol24h: +d.volCcy24h, ts: +d.ts };
}

export async function funding(instId: string) {
  const [d] = await get<Record<string, string>[]>(`/public/funding-rate?instId=${instId}`);
  return { rate: +d.fundingRate, nextTime: +d.fundingTime };
}

export async function openInterest(instId: string) {
  const [d] = await get<Record<string, string>[]>(`/public/open-interest?instType=SWAP&instId=${instId}`);
  return { coins: +d.oiCcy, usd: +d.oiUsd };
}

export async function longShortRatio(ccy: string, period = "1H") {
  const rows = await get<string[][]>(`/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=${period}`);
  return rows.slice(0, 24).map((r) => ({ t: +r[0], ratio: +r[1] }));
}

export async function openInterestHistory(ccy: string, period = "1H") {
  const rows = await get<string[][]>(`/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=${period}`);
  return rows.slice(0, 24).map((r) => ({ t: +r[0], oiUsd: +r[1], volumeUsd: +r[2] }));
}
