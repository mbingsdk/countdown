import { DurableObject } from "cloudflare:workers";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });

const pad = (n) => String(n).padStart(2, "0");
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

// Waktu dihitung dari timestamp, jadi timer tetap "jalan" walau tidak ada page yang terbuka.
function view(s, now) {
  const elapsed = s.base + (s.running ? now - s.startedAt : 0);
  const pos = elapsed % s.duration;
  const remaining = s.duration - pos;
  const secs = Math.ceil(remaining / 1000);
  return {
    running: s.running,
    duration_ms: s.duration,
    elapsed_ms: elapsed,
    remaining_ms: remaining,
    remaining_seconds: secs,
    formatted: hms(secs),
    cycle: Math.floor(elapsed / s.duration) + 1,
    progress: pos / s.duration,
    server_time: now,
  };
}

export class Timer extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const now = Date.now();
    let s = (await this.ctx.storage.get("s")) ?? { duration: 60000, running: false, base: 0, startedAt: 0 };

    if (p === "/api/start") {
      if (!s.running) { s.running = true; s.startedAt = now; }
    } else if (p === "/api/stop") {
      if (s.running) { s.base += now - s.startedAt; s.running = false; }
    } else if (p === "/api/reset") {
      s.base = 0; s.startedAt = now;
    } else if (p === "/api/duration") {
      let sec = url.searchParams.get("seconds");
      if (req.method === "POST") { try { sec = (await req.json()).seconds; } catch {} }
      sec = Number(sec);
      if (!(sec >= 1 && sec <= 8640000)) return json({ error: "seconds harus antara 1 dan 8640000" }, 400);
      s.duration = Math.round(sec * 1000); s.base = 0; s.startedAt = now;
    } else if (p !== "/api/time") {
      return json({ error: "not found" }, 404);
    }

    if (p !== "/api/time") await this.ctx.storage.put("s", s);
    const v = view(s, now);
    if (url.searchParams.get("format") === "text")
      return new Response(v.formatted, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", ...CORS } });
    return json(v);
  }
}

// true = password benar, false = salah, null = secret PASSWORD belum di-set
async function authorized(req, env) {
  if (!env.PASSWORD) return null;
  const h = req.headers.get("Authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(env.PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname.startsWith("/api/")) {
      // /api/time tetap publik (baca saja); semua endpoint lain butuh password
      if (url.pathname !== "/api/time") {
        const ok = await authorized(req, env);
        if (ok === null) return json({ error: "Secret PASSWORD belum di-set" }, 500);
        if (!ok) return json({ error: "Password salah" }, 401);
        if (url.pathname === "/api/login") return json({ ok: true });
      }
      return env.TIMER.get(env.TIMER.idFromName("main")).fetch(req);
    }
    return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};

const HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loop Countdown</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#080b0e;--ink:#e9f7e8;--mute:#78907d;--track:#1b2b26;--accent:#b9ff38;--cyan:#42f5d0;--panel:#101814;--line:#26372d;--on:#081008}
*{box-sizing:border-box;scrollbar-color:var(--accent) #0d1310;scrollbar-width:thin}
*::-webkit-scrollbar{width:10px;height:8px}
*::-webkit-scrollbar-track{background:#0d1310}
*::-webkit-scrollbar-thumb{background:var(--accent);border:3px solid #0d1310;border-radius:2px}
html{height:100%;scrollbar-color:var(--accent) #0d1310;scrollbar-width:thin}
html,body{min-height:100%;margin:0}
body{background-color:var(--bg);background-image:linear-gradient(rgba(66,245,208,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(66,245,208,.035) 1px,transparent 1px);background-size:32px 32px;color:var(--ink);font-family:'Barlow Condensed',sans-serif;display:grid;place-items:center;padding:20px;overflow-y:auto}
body::-webkit-scrollbar{width:10px}
body::-webkit-scrollbar-track{background:#0d1310}
body::-webkit-scrollbar-thumb{background:var(--accent);border:3px solid #0d1310;border-radius:2px}
main{width:100%;max-width:1080px;display:grid;grid-template-columns:minmax(400px,1.1fr) minmax(360px,.9fr);gap:24px;position:relative;padding:34px 28px 24px;background:rgba(10,16,13,.92);border:1px solid var(--line);box-shadow:0 0 0 1px rgba(185,255,56,.05),0 20px 70px rgba(0,0,0,.4);clip-path:polygon(0 14px,14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px))}
main:before{content:'LOOP // COUNTDOWN';position:absolute;top:8px;left:26px;color:var(--cyan);font:11px 'Share Tech Mono',monospace;letter-spacing:.16em}
.dial{position:relative;grid-column:1;grid-row:1 / span 6;align-self:center;justify-self:center;aspect-ratio:1;width:min(100%,620px);filter:drop-shadow(0 0 18px rgba(185,255,56,.08))}
.dial svg{width:100%;height:100%;transform:rotate(-90deg)}
.dial circle{fill:none;stroke-width:6;stroke-linecap:butt}
.track{stroke:var(--track)}
.bar{filter:drop-shadow(0 0 5px currentColor)}
#ring-seconds{color:var(--accent);stroke:var(--accent)}
#ring-minutes{color:var(--cyan);stroke:var(--cyan)}
#ring-hours{color:#f5b942;stroke:#f5b942}
.center{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:6px}
#time{font:600 clamp(46px,15vw,76px) 'Share Tech Mono',monospace;font-variant-numeric:tabular-nums;letter-spacing:.02em;text-shadow:0 0 16px rgba(185,255,56,.28)}
#meta{color:var(--mute);font:12px 'Share Tech Mono',monospace;text-transform:uppercase;letter-spacing:.08em}
#units{color:var(--mute);font:10px 'Share Tech Mono',monospace;letter-spacing:.18em}
.dot{display:inline-block;width:7px;height:7px;border-radius:1px;background:var(--track);margin-right:6px}
.running .dot{background:var(--accent);box-shadow:0 0 8px var(--accent);animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.25}}
.row{grid-column:2;display:flex;gap:8px}
button{font:600 16px 'Barlow Condensed',sans-serif;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);border-radius:2px;padding:12px 16px;cursor:pointer;background:var(--panel);color:var(--ink);flex:1;transition:background .15s,border-color .15s,transform .15s}
button:hover{border-color:var(--cyan);background:#17241d}
button.main{background:var(--accent);border-color:var(--accent);color:var(--on);box-shadow:0 0 14px rgba(185,255,56,.18)}
button.main:hover{background:#d0ff72;border-color:#d0ff72}
button:disabled{cursor:not-allowed;opacity:.35}
button:focus-visible,input:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
button:active{transform:translateY(1px)}
.set{grid-column:2;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--cyan);padding:12px;display:flex;align-items:end;gap:8px}
.set label{display:grid;gap:5px;font:12px 'Share Tech Mono',monospace;color:var(--mute);flex:1;text-transform:uppercase}
.set input{width:100%;font:20px 'Share Tech Mono',monospace;padding:7px 4px;border-radius:1px;border:1px solid var(--line);background:var(--bg);color:var(--ink);text-align:center;appearance:textfield;-moz-appearance:textfield;-webkit-appearance:none}
.set input::-webkit-inner-spin-button,.set input::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;display:none;margin:0}
.set button{flex:0 0 auto}
.locked .ctl{display:none}
#app:not(.locked) .gate{display:none}
#msg{grid-column:2;color:var(--cyan);font:12px 'Share Tech Mono',monospace;min-height:1em;margin:0;text-align:center}
#lock{grid-column:2;background:none;color:var(--mute);font:12px 'Share Tech Mono',monospace;padding:0;flex:none;justify-self:center;border:0}
#lock:hover{background:none;color:var(--accent);border:0}
code{display:block;grid-column:2;position:relative;background:linear-gradient(135deg,rgba(66,245,208,.07),transparent 38%),#0b110e;border:1px solid var(--line);border-top:2px solid var(--cyan);padding:30px 14px 13px;font:11px/1.75 'Share Tech Mono',monospace;color:var(--mute);overflow:auto;white-space:pre-wrap;scrollbar-color:var(--cyan) #0b110e;scrollbar-width:thin;box-shadow:inset 0 0 24px rgba(66,245,208,.035)}
code:before{content:'NETWORK // API CONSOLE';position:absolute;top:8px;left:14px;color:var(--cyan);font-size:10px;letter-spacing:.14em}
code::-webkit-scrollbar{height:6px}
code::-webkit-scrollbar-track{background:#0b110e}
code::-webkit-scrollbar-thumb{background:var(--cyan);border-radius:0}
@media (max-width:760px){body{padding:10px}main{grid-template-columns:1fr;max-width:520px;padding:26px 16px 18px;gap:16px}.dial,.row,.set,#msg,#lock,code{grid-column:1}.dial{grid-row:auto;width:min(100%,460px)}.set{flex-wrap:wrap}.set label{min-width:28%}.set button{width:100%}}
@media (prefers-reduced-motion:reduce){.running .dot{animation:none}}
</style>
</head>
<body>
<main id="app">
  <div class="dial">
    <svg viewBox="0 0 260 260">
      <circle class="track" cx="130" cy="130" r="118"/><circle class="bar" id="ring-seconds" cx="130" cy="130" r="118"/>
      <circle class="track" cx="130" cy="130" r="94"/><circle class="bar" id="ring-minutes" cx="130" cy="130" r="94"/>
      <circle class="track" cx="130" cy="130" r="70"/><circle class="bar" id="ring-hours" cx="130" cy="130" r="70"/>
    </svg>
    <div class="center"><div id="time">--:--:--</div><div id="meta"><span class="dot"></span><span id="state">Memuat…</span></div><div id="units">SEC · MIN · HRS</div></div>
  </div>
  <div class="row ctl">
    <button class="main" id="start">Start</button>
    <button id="stop">Stop</button>
    <button id="reset">Reset</button>
  </div>
  <div class="set ctl">
    <label>Jam<input id="h" type="number" min="0" value="0"></label>
    <label>Menit<input id="m" type="number" min="0" value="1"></label>
    <label>Detik<input id="s" type="number" min="0" value="0"></label>
    <button id="save">Simpan</button>
  </div>
  <form class="set gate" id="login">
    <label>Password kontrol<input id="pw" type="password" autocomplete="current-password"></label>
    <button class="main">Buka</button>
  </form>
  <p id="msg"></p>
  <button class="ctl" id="lock" type="button">Kunci kontrol</button>
  <code id="api"></code>
</main>
<script>
const $ = (id) => document.getElementById(id);
const rings = [
  { element: $("ring-seconds"), circumference: 2 * Math.PI * 118 },
  { element: $("ring-minutes"), circumference: 2 * Math.PI * 94 },
  { element: $("ring-hours"), circumference: 2 * Math.PI * 70 },
];
rings.forEach(({ element, circumference }) => { element.style.strokeDasharray = circumference; });
let S = null, at = 0, filled = false, pw = "";
try { pw = localStorage.getItem("pw") || ""; } catch (e) {}
function setPw(v) {
  pw = v;
  try { v ? localStorage.setItem("pw", v) : localStorage.removeItem("pw"); } catch (e) {}
  $("app").classList.toggle("locked", !pw);
}
setPw(pw);
$("api").textContent = [
  "PUBLIC READ", "> GET  " + location.origin + "/api/time",
  "  Status timer dan sisa waktu", "",
  "> GET  " + location.origin + "/api/time?format=text",
  "  Sisa waktu sebagai plain text", "",
  "CONTROL WRITE", "> POST " + location.origin + "/api/start",
  "> POST " + location.origin + "/api/stop",
  "> POST " + location.origin + "/api/reset",
  "> POST " + location.origin + "/api/duration",
  "  Body: { 'seconds': 60 }",
  "  AUTH // Bearer PASSWORD"
].join("\\n");

async function call(path, opt) {
  try {
    opt = opt || {};
    if (pw) opt.headers = { ...(opt.headers || {}), Authorization: "Bearer " + pw };
    const r = await fetch(path, opt);
    const d = await r.json();
    if (r.status === 401) { setPw(""); $("msg").textContent = "Password salah."; return; }
    if (!r.ok) { $("msg").textContent = d.error || "Gagal"; return; }
    $("msg").textContent = "";
    if (path === "/api/login") return;
    S = d; at = performance.now();
    if (!filled) {
      const t = Math.round(d.duration_ms / 1000);
      $("h").value = Math.floor(t / 3600); $("m").value = Math.floor(t % 3600 / 60); $("s").value = t % 60;
      filled = true;
    }
    $("app").classList.toggle("running", d.running);
    $("state").textContent = d.running ? "Berjalan" : "Berhenti";
    $("start").disabled = d.running; $("stop").disabled = !d.running;
  } catch (e) { $("state").textContent = "Koneksi terputus"; }
}
const pad = (n) => String(n).padStart(2, "0");
function tick() {
  if (S) {
    const e = S.elapsed_ms + (S.running ? performance.now() - at : 0);
    const pos = e % S.duration_ms;
    const secs = Math.ceil((S.duration_ms - pos) / 1000);
    const t = pad(Math.floor(secs / 3600)) + ":" + pad(Math.floor(secs % 3600 / 60)) + ":" + pad(secs % 60);
    $("time").textContent = t;
    document.title = t + " · Loop Countdown";
    const remaining = Math.ceil((S.duration_ms - pos) / 1000);
    const configured = Math.round(S.duration_ms / 1000);
    const configuredHours = Math.floor(configured / 3600);
    const configuredMinutes = configured >= 3600 ? 60 : Math.floor(configured % 3600 / 60);
    const configuredSeconds = configured >= 60 ? 60 : configured;
    const remainingHours = Math.floor(remaining / 3600);
    const remainingMinutes = Math.floor(remaining % 3600 / 60);
    const remainingSeconds = remaining % 60;
    const ratio = (value, maximum) => maximum ? Math.min(value / maximum, 1) : 0;
    const parts = [
      ratio(remainingSeconds, configuredSeconds),
      ratio(remainingMinutes, configuredMinutes),
      ratio(remainingHours, configuredHours),
    ];
    parts.forEach((part, index) => {
      rings[index].element.style.strokeDashoffset = rings[index].circumference * (1 - part);
    });
    $("state").textContent = (S.running ? "Berjalan" : "Berhenti") + " · putaran " + (Math.floor(e / S.duration_ms) + 1);
  }
  requestAnimationFrame(tick);
}
$("start").onclick = () => call("/api/start", { method: "POST" });
$("stop").onclick = () => call("/api/stop", { method: "POST" });
$("reset").onclick = () => call("/api/reset", { method: "POST" });
$("save").onclick = () => {
  const sec = (+$("h").value || 0) * 3600 + (+$("m").value || 0) * 60 + (+$("s").value || 0);
  call("/api/duration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seconds: sec }) });
};
$("login").onsubmit = async (e) => {
  e.preventDefault();
  const v = $("pw").value;
  $("pw").value = "";
  if (!v) return;
  setPw(v);
  await call("/api/login", { method: "POST" });
  if (pw) call("/api/time");
};
$("lock").onclick = () => { setPw(""); $("msg").textContent = ""; };
call("/api/time");
setInterval(() => call("/api/time"), 5000);
tick();
</script>
</body>
</html>`;
