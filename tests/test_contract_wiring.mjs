import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
for (const path of ["app/api/watchlist/route.ts", "lib/telegram-alerts.ts", "app/api/telegram/webhook/route.ts"]) {
  const source = read(path);
  assert.match(source, /evaluateSetup\(/, `${path} must consume the shared decision engine`);
}
assert.match(read("lib/telegram-alerts.ts"), /openPaperPlan\(/, "Telegram scan must feed the paper ledger");
assert.match(read("lib/telegram-alerts.ts"), /reconcilePaperPositions\(/, "Telegram scan must reconcile open paper positions");
assert.doesNotMatch(read("lib/patterns.ts"), /style:\s*"pinbar_reversal"/, "Research-only pinbar must not be emitted by production detector");

console.log("All decision-engine wiring tests passed!");
