// Reads [{t,o,h,l,c,v}...][] windows as JSON on stdin, prints the triggered setups of lib/patterns.ts per window.
import { analyse } from "../../lib/patterns.ts";
let buf = "";
process.stdin.on("data", (d) => (buf += d)).on("end", () => {
  const windows = JSON.parse(buf);
  const out = windows.map((w) => analyse(w.map((c) => ({ ...c, closed: true }))).setups
    .filter((s) => s.state === "triggered")
    .map((s) => ({ style: s.style, side: s.side, stop: s.stop })));
  process.stdout.write(JSON.stringify(out));
});
