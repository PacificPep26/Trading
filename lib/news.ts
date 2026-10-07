import "server-only";

export type NewsItem = { title: string; link: string; source: string; published?: string };

function decode(text: string) {
  return text.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

function parseRss(xml: string, source: string): NewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 5).map((m) => {
    const item = m[1];
    const read = (tag: string) => decode(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
    return { title: read("title"), link: read("link"), published: read("pubDate"), source };
  }).filter((x) => x.title && x.link);
}

export async function fetchNews(): Promise<{ items: NewsItem[]; warning?: string }> {
  const sources = [
    ["CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"],
    ["Solana", "https://solana.com/news/rss.xml"],
  ] as const;
  const results = await Promise.allSettled(sources.map(async ([name, url]) => {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return parseRss(await res.text(), name);
  }));
  const items = results.flatMap((r) => r.status === "fulfilled" ? r.value : []).slice(0, 8);
  return { items, warning: results.some((r) => r.status === "rejected") ? "Một nguồn tin tạm thời không tải được; xác suất không bị thay đổi." : undefined };
}
