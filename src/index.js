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

const GAME_STAGES = [
  { duration: 300000, time: "05:59" },
  { duration: 300000, time: "06:59" },
  { duration: 300000, time: "08:59" },
  { duration: 300000, time: "10:29" },
  { duration: 300000, time: "11:59" },
  { duration: 300000, time: "13:29" },
  { duration: 300000, time: "14:59" },
  { duration: 300000, time: "16:29" },
  { duration: 300000, time: "17:29" },
  { duration: 240000, time: "19:29" },
  { duration: 120000, time: "20:59" },
  { duration: 360000, time: "00:00" },
  { duration: 120000, time: "01:59" },
  { duration: 120000, time: "03:59" },
];
const GAME_CYCLE_MS = GAME_STAGES.reduce((sum, stage) => sum + stage.duration, 0);
const mod = (n, m) => ((n % m) + m) % m;

function gameView(g, now) {
  const elapsed = g.base + (g.running ? now - g.startedAt : 0);
  const position = mod(elapsed, GAME_CYCLE_MS);
  let cursor = 0;
  let index = GAME_STAGES.length - 1;

  for (let i = 0; i < GAME_STAGES.length; i++) {
    const end = cursor + GAME_STAGES[i].duration;
    if (position < end) { index = i; break; }
    cursor = end;
  }

  const stage = GAME_STAGES[index];
  const stageElapsed = position - cursor;
  const remaining = stage.duration - stageElapsed;

  return {
    running: g.running,
    stage: index + 1,
    game_time: stage.time,
    next_game_time: GAME_STAGES[(index + 1) % GAME_STAGES.length].time,
    stage_duration_ms: stage.duration,
    stage_elapsed_ms: stageElapsed,
    remaining_ms: remaining,
    remaining_seconds: Math.ceil(remaining / 1000),
    position_ms: position,
    cycle_duration_ms: GAME_CYCLE_MS,
  };
}

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
    const [storedTimer, storedGame] = await Promise.all([
      this.ctx.storage.get("s"),
      this.ctx.storage.get("game"),
    ]);
    let s = storedTimer ?? { duration: 60000, running: false, base: 0, startedAt: 0 };
    let g = storedGame ?? { running: false, base: 0, startedAt: 0 };
    let saveTimer = false;
    let saveGame = false;

    if (p === "/api/start") {
      if (!s.running) { s.running = true; s.startedAt = now; saveTimer = true; }
    } else if (p === "/api/stop") {
      if (s.running) { s.base += now - s.startedAt; s.running = false; saveTimer = true; }
    } else if (p === "/api/reset") {
      s.base = 0; s.startedAt = now; saveTimer = true;
    } else if (p === "/api/adjust") {
      let sec = url.searchParams.get("seconds");
      if (req.method === "POST") { try { sec = (await req.json()).seconds; } catch {} }
      sec = Number(sec);
      if (!Number.isFinite(sec) || sec === 0 || Math.abs(sec) > 3600)
        return json({ error: "seconds harus antara -3600 dan 3600, selain 0" }, 400);

      // Positif = majukan posisi countdown (sisa waktu berkurang).
      // Negatif = mundurkan posisi countdown (sisa waktu bertambah).
      const elapsed = s.base + (s.running ? now - s.startedAt : 0);
      s.base = Math.max(0, elapsed + Math.round(sec * 1000));
      if (s.running) s.startedAt = now;
      saveTimer = true;
    } else if (p === "/api/duration") {
      let sec = url.searchParams.get("seconds");
      if (req.method === "POST") { try { sec = (await req.json()).seconds; } catch {} }
      sec = Number(sec);
      if (!(sec >= 1 && sec <= 8640000)) return json({ error: "seconds harus antara 1 dan 8640000" }, 400);
      s.duration = Math.round(sec * 1000); s.base = 0; s.startedAt = now; saveTimer = true;
    } else if (p === "/api/game/start") {
      if (!g.running) { g.running = true; g.startedAt = now; saveGame = true; }
    } else if (p === "/api/game/stop") {
      if (g.running) {
        g.base = mod(g.base + now - g.startedAt, GAME_CYCLE_MS);
        g.running = false;
        saveGame = true;
      }
    } else if (p === "/api/game/reset") {
      g.base = 0;
      g.startedAt = now;
      saveGame = true;
    } else if (p === "/api/game/stage") {
      let stage = url.searchParams.get("stage");
      if (req.method === "POST") { try { stage = (await req.json()).stage; } catch {} }
      stage = Number(stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > GAME_STAGES.length)
        return json({ error: "stage harus antara 1 dan " + GAME_STAGES.length }, 400);

      g.base = GAME_STAGES
        .slice(0, stage - 1)
        .reduce((sum, item) => sum + item.duration, 0);
      g.startedAt = now;
      saveGame = true;
    } else if (p === "/api/game/adjust") {
      let sec = url.searchParams.get("seconds");
      if (req.method === "POST") { try { sec = (await req.json()).seconds; } catch {} }
      sec = Number(sec);
      if (!Number.isFinite(sec) || sec === 0 || Math.abs(sec) > 3600)
        return json({ error: "seconds harus antara -3600 dan 3600, selain 0" }, 400);

      const gameElapsed = g.base + (g.running ? now - g.startedAt : 0);
      g.base = mod(gameElapsed + Math.round(sec * 1000), GAME_CYCLE_MS);
      if (g.running) g.startedAt = now;
      saveGame = true;
    } else if (p !== "/api/time") {
      return json({ error: "not found" }, 404);
    }

    const writes = [];
    if (saveTimer) writes.push(this.ctx.storage.put("s", s));
    if (saveGame) writes.push(this.ctx.storage.put("game", g));
    if (writes.length) await Promise.all(writes);

    const v = { ...view(s, now), game_time: gameView(g, now) };
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
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#090a09;
  --surface:#101210;
  --surface-2:#151815;
  --surface-3:#1b1f1b;
  --ink:#f2f5ed;
  --muted:#8c9488;
  --muted-2:#626960;
  --line:#262b25;
  --line-strong:#343b32;
  --accent:#c8ff4a;
  --accent-soft:rgba(200,255,74,.11);
  --accent-dim:#8daf36;
  --danger:#ff6b5f;
  --track:#20251f;
  --mono:'IBM Plex Mono',monospace;
  --sans:'DM Sans',sans-serif;
}
*{box-sizing:border-box}
html,body{min-height:100%;margin:0}
html{background:var(--bg);scrollbar-color:var(--line-strong) var(--bg);scrollbar-width:thin}
body{
  background:
    radial-gradient(circle at 18% 8%,rgba(200,255,74,.045),transparent 30%),
    var(--bg);
  color:var(--ink);
  font-family:var(--sans);
  padding:28px;
}
button,input{font:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
#app{
  width:min(1180px,100%);
  margin:0 auto;
  border:1px solid var(--line);
  background:var(--surface);
  box-shadow:0 26px 80px rgba(0,0,0,.34);
}
.topbar{
  min-height:62px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:0 22px;
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.brand-mark{
  width:29px;height:29px;
  display:grid;place-items:center;
  border:1px solid var(--line-strong);
  background:var(--surface-2);
  color:var(--accent);
  font:600 12px var(--mono);
}
.brand-copy{display:grid;gap:1px;min-width:0}
.brand-title{font:600 13px var(--mono);letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.brand-sub{font:500 11px var(--mono);color:var(--muted-2);letter-spacing:.04em;white-space:nowrap}
.status{
  display:flex;align-items:center;gap:8px;
  padding:7px 10px;
  border:1px solid var(--line);
  background:var(--surface-2);
  color:var(--muted);
  font:500 11px var(--mono);
  text-transform:uppercase;
  letter-spacing:.06em;
  white-space:nowrap;
}
.dot{width:7px;height:7px;border-radius:50%;background:#4c534a}
.running .dot{background:var(--accent);box-shadow:0 0 0 4px rgba(200,255,74,.08),0 0 14px rgba(200,255,74,.35);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.42}}

.workspace{
  display:grid;
  grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr);
  min-height:650px;
}
.timer-panel{
  position:relative;
  display:grid;
  place-items:center;
  padding:48px 34px;
  border-right:1px solid var(--line);
  overflow:hidden;
}
.timer-panel:before{
  content:'';
  position:absolute;
  width:78%;aspect-ratio:1;
  border:1px solid rgba(255,255,255,.025);
  border-radius:50%;
  pointer-events:none;
}
.dial{
  position:relative;
  width:min(100%,570px);
  aspect-ratio:1;
}
.dial svg{width:100%;height:100%;transform:rotate(-90deg)}
.dial circle{fill:none;stroke-width:4.5;stroke-linecap:round}
.track{stroke:var(--track)}
.bar{transition:stroke-dashoffset .18s linear}
#ring-seconds{stroke:var(--accent);filter:drop-shadow(0 0 4px rgba(200,255,74,.28))}
#ring-minutes{stroke:#8e9b85}
#ring-hours{stroke:#4f574c}
.center{
  position:absolute;inset:0;
  display:grid;place-content:center;
  text-align:center;
  gap:11px;
}
#time{
  font:500 clamp(48px,7.8vw,88px) var(--mono);
  font-variant-numeric:tabular-nums;
  letter-spacing:-.055em;
  line-height:1;
}
#meta{font:500 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
#units{font:500 10px var(--mono);color:var(--muted-2);letter-spacing:.22em}
.timer-caption{
  position:absolute;
  left:26px;bottom:24px;
  color:var(--muted-2);
  font:500 10px var(--mono);
  text-transform:uppercase;
  letter-spacing:.1em;
}

.controls{
  display:flex;
  flex-direction:column;
  gap:14px;
  padding:24px;
  background:#0d0f0d;
}
.section-heading{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-bottom:10px;
}
.eyebrow{
  color:var(--muted-2);
  font:600 10px var(--mono);
  letter-spacing:.13em;
  text-transform:uppercase;
}
.hint{color:var(--muted-2);font:400 10px var(--mono)}
.control-card{
  padding:15px;
  border:1px solid var(--line);
  background:var(--surface);
}
.game-card{padding:17px}
.game-readout{
  display:grid;
  grid-template-columns:1fr auto;
  gap:14px;
  align-items:end;
  margin-bottom:12px;
}
.game-clock{
  font:500 clamp(34px,4vw,48px) var(--mono);
  letter-spacing:-.05em;
  line-height:1;
}
.game-stage{
  margin-top:6px;
  color:var(--muted-2);
  font:500 10px var(--mono);
  text-transform:uppercase;
  letter-spacing:.08em;
}
.game-next{text-align:right}
.game-next span{
  display:block;
  margin-bottom:5px;
  color:var(--muted-2);
  font:600 9px var(--mono);
  text-transform:uppercase;
  letter-spacing:.1em;
}
.game-next strong{
  color:var(--accent);
  font:500 20px var(--mono);
}
.game-progress{
  height:3px;
  overflow:hidden;
  background:var(--track);
  margin:0 0 13px;
}
.game-progress i{
  display:block;
  width:0;
  height:100%;
  background:var(--accent);
  transition:width .18s linear;
}
.game-info{
  display:flex;
  justify-content:space-between;
  gap:10px;
  margin-bottom:12px;
  color:var(--muted-2);
  font:400 10px var(--mono);
}
.game-stage-set{
  display:grid;
  grid-template-columns:1fr auto;
  gap:8px;
  margin-bottom:8px;
}
.game-stage-set select{
  min-width:0;
  height:42px;
  border:1px solid var(--line-strong);
  border-radius:5px;
  background:#0b0d0b;
  color:var(--ink);
  padding:0 10px;
  font:500 11px var(--mono);
}
.game-stage-set button{min-width:72px}
.game-action-row{margin-bottom:8px}
.game-sync-grid{margin-top:8px}
.game-running{
  color:var(--accent);
}
.row{display:flex;gap:8px}
.action-row button{min-height:48px}
button{
  border:1px solid var(--line-strong);
  background:var(--surface-2);
  color:var(--ink);
  border-radius:5px;
  min-height:42px;
  padding:9px 13px;
  font:600 12px var(--mono);
  letter-spacing:.045em;
  text-transform:uppercase;
  transition:background .14s,border-color .14s,color .14s,transform .14s;
}
button:hover{background:var(--surface-3);border-color:#4a5247}
button:active{transform:translateY(1px)}
button.main{
  background:var(--accent);
  color:#10130d;
  border-color:var(--accent);
}
button.main:hover{background:#d7ff76;border-color:#d7ff76}
button:disabled{opacity:.3;cursor:not-allowed}
.action-row button{flex:1}
#reset{color:#c5cbc1}
.sync-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.sync-grid button{padding-inline:5px;font-size:11px}
.sync-grid button:nth-child(1),.sync-grid button:nth-child(2){color:#c3cbc0}
.sync-grid button:nth-child(3),.sync-grid button:nth-child(4){color:var(--accent)}
.sync-readout{
  display:flex;align-items:center;justify-content:space-between;
  margin-top:10px;
  color:var(--muted-2);
  font:400 10px var(--mono);
}
.duration-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr) auto;
  gap:8px;
  align-items:end;
}
.field{display:grid;gap:6px}
.field span{
  color:var(--muted-2);
  font:600 9px var(--mono);
  text-transform:uppercase;
  letter-spacing:.1em;
}
.field input{
  width:100%;
  min-width:0;
  height:44px;
  padding:0 7px;
  border:1px solid var(--line-strong);
  border-radius:5px;
  background:#0b0d0b;
  color:var(--ink);
  text-align:center;
  font:500 16px var(--mono);
  appearance:textfield;
  -moz-appearance:textfield;
}
.field input::-webkit-inner-spin-button,.field input::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;margin:0}
#save{height:44px}
.gate{display:grid;gap:10px}
.gate .login-row{display:grid;grid-template-columns:1fr auto;gap:8px}
.gate input{
  width:100%;height:44px;
  border:1px solid var(--line-strong);
  border-radius:5px;
  background:#0b0d0b;
  color:var(--ink);
  padding:0 12px;
  font:500 13px var(--mono);
}
.locked .ctl{display:none!important}
#app:not(.locked) .gate{display:none}
#msg{
  min-height:17px;
  margin:0;
  color:var(--accent);
  text-align:center;
  font:400 11px var(--mono);
}
#lock{
  align-self:center;
  min-height:0;
  padding:4px 6px;
  border:0;
  background:transparent;
  color:var(--muted-2);
  font-size:10px;
}
#lock:hover{background:transparent;color:var(--ink)}
.api-panel{
  margin-top:auto;
  border:1px solid var(--line);
  background:var(--surface);
}
.api-panel summary{
  list-style:none;
  cursor:pointer;
  padding:13px 14px;
  color:var(--muted);
  font:600 10px var(--mono);
  letter-spacing:.09em;
  text-transform:uppercase;
  user-select:none;
}
.api-panel summary::-webkit-details-marker{display:none}
.api-panel summary:after{content:'+';float:right;color:var(--muted-2);font-size:14px;line-height:10px}
.api-panel[open] summary:after{content:'−'}
.api-panel[open] summary{border-bottom:1px solid var(--line)}
code{
  display:block;
  max-height:230px;
  overflow:auto;
  white-space:pre-wrap;
  padding:14px;
  color:#889184;
  background:#0a0c0a;
  font:400 10px/1.7 var(--mono);
  scrollbar-color:var(--line-strong) #0a0c0a;
  scrollbar-width:thin;
}

@media (max-width:850px){
  body{padding:14px}
  .workspace{grid-template-columns:1fr}
  .timer-panel{border-right:0;border-bottom:1px solid var(--line);padding:35px 22px;min-height:520px}
  .controls{padding:18px}
  .timer-caption{display:none}
}
@media (max-width:520px){
  body{padding:0}
  #app{border-left:0;border-right:0}
  .topbar{padding:0 15px}
  .brand-sub{display:none}
  .workspace{min-height:0}
  .timer-panel{min-height:390px;padding:24px 15px}
  .controls{padding:14px;gap:10px}
  .control-card{padding:12px}
  .sync-grid{grid-template-columns:repeat(2,1fr)}
  .duration-grid{grid-template-columns:repeat(3,1fr)}
  #save{grid-column:1 / -1;width:100%}
  #time{font-size:clamp(43px,15vw,68px)}
}
@media (prefers-reduced-motion:reduce){
  .running .dot{animation:none}
  .bar,button{transition:none}
}
</style>
</head>
<body>
<main id="app">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">LC</div>
      <div class="brand-copy">
        <div class="brand-title">Loop Countdown</div>
        <div class="brand-sub">Durable timer · server synchronized</div>
      </div>
    </div>
    <div class="status"><span class="dot"></span><span id="state">Memuat…</span></div>
  </header>

  <div class="workspace">
    <section class="timer-panel">
      <div class="dial">
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <circle class="track" cx="130" cy="130" r="118"/><circle class="bar" id="ring-seconds" cx="130" cy="130" r="118"/>
          <circle class="track" cx="130" cy="130" r="94"/><circle class="bar" id="ring-minutes" cx="130" cy="130" r="94"/>
          <circle class="track" cx="130" cy="130" r="70"/><circle class="bar" id="ring-hours" cx="130" cy="130" r="70"/>
        </svg>
        <div class="center">
          <div id="time">--:--:--</div>
          <div id="meta">Waiting for server</div>
          <div id="units">HRS · MIN · SEC</div>
        </div>
      </div>
      <div class="timer-caption">Timestamp based · survives closed tabs</div>
    </section>

    <aside class="controls">
      <section class="control-card game-card">
        <div class="section-heading">
          <span class="eyebrow">Game Time</span>
          <span class="hint" id="gameStatus">Berhenti</span>
        </div>
        <div class="game-readout">
          <div>
            <div class="game-clock" id="gameTime">05:59</div>
            <div class="game-stage" id="gameStage">Stage #1</div>
          </div>
          <div class="game-next">
            <span>Berubah dalam</span>
            <strong id="gameRemaining">05:00</strong>
          </div>
        </div>
        <div class="game-progress"><i id="gameProgress"></i></div>
        <div class="game-info">
          <span id="gameDuration">Durasi 05:00</span>
          <span id="gameNext">Next 06:59</span>
        </div>
        <div class="game-stage-set ctl">
          <select id="gameStageSelect" aria-label="Pilih Game Time stage">
            <option value="1">#1 · 05:59 · 05:00</option>
            <option value="2">#2 · 06:59 · 05:00</option>
            <option value="3">#3 · 08:59 · 05:00</option>
            <option value="4">#4 · 10:29 · 05:00</option>
            <option value="5">#5 · 11:59 · 05:00</option>
            <option value="6">#6 · 13:29 · 05:00</option>
            <option value="7">#7 · 14:59 · 05:00</option>
            <option value="8">#8 · 16:29 · 05:00</option>
            <option value="9">#9 · 17:29 · 05:00</option>
            <option value="10">#10 · 19:29 · 04:00</option>
            <option value="11">#11 · 20:59 · 02:00</option>
            <option value="12">#12 · 00:00 · 06:00</option>
            <option value="13">#13 · 01:59 · 02:00</option>
            <option value="14">#14 · 03:59 · 02:00</option>
          </select>
          <button id="gameSetStage">Set</button>
        </div>
        <div class="row action-row game-action-row ctl">
          <button class="main" id="gameStart">Start</button>
          <button id="gameStop">Stop</button>
          <button id="gameReset">Reset</button>
        </div>
        <div class="sync-grid game-sync-grid ctl">
          <button id="gameBack10">−10s</button>
          <button id="gameBack1">−1s</button>
          <button id="gameForward1">+1s</button>
          <button id="gameForward10">+10s</button>
        </div>
      </section>

      <section class="control-card ctl">
        <div class="section-heading">
          <span class="eyebrow">Timer control</span>
          <span class="hint">main session</span>
        </div>
        <div class="row action-row">
          <button class="main" id="start">Start</button>
          <button id="stop">Stop</button>
          <button id="reset">Reset</button>
        </div>
      </section>

      <section class="control-card ctl">
        <div class="section-heading">
          <span class="eyebrow">Live sync</span>
          <span class="hint">tanpa stop timer</span>
        </div>
        <div class="sync-grid">
          <button id="back10">−10s</button>
          <button id="back1">−1s</button>
          <button id="forward1">+1s</button>
          <button id="forward10">+10s</button>
        </div>
        <div class="sync-readout">
          <span>− tambah sisa waktu</span>
          <span>+ kurangi sisa waktu</span>
        </div>
      </section>

      <section class="control-card ctl">
        <div class="section-heading">
          <span class="eyebrow">Duration</span>
          <span class="hint">reset cycle saat disimpan</span>
        </div>
        <div class="duration-grid">
          <label class="field"><span>Jam</span><input id="h" type="number" min="0" value="0"></label>
          <label class="field"><span>Menit</span><input id="m" type="number" min="0" value="1"></label>
          <label class="field"><span>Detik</span><input id="s" type="number" min="0" value="0"></label>
          <button id="save">Set</button>
        </div>
      </section>

      <form class="control-card gate" id="login">
        <div class="section-heading">
          <span class="eyebrow">Control access</span>
          <span class="hint">password required</span>
        </div>
        <div class="login-row">
          <input id="pw" type="password" autocomplete="current-password" placeholder="Password kontrol">
          <button class="main">Unlock</button>
        </div>
      </form>

      <p id="msg"></p>
      <button class="ctl" id="lock" type="button">Kunci kontrol</button>

      <details class="api-panel">
        <summary>API / Advanced</summary>
        <code id="api"></code>
      </details>
    </aside>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const GAME_STAGES = [
  { seconds: 300, time: "05:59" },
  { seconds: 300, time: "06:59" },
  { seconds: 300, time: "08:59" },
  { seconds: 300, time: "10:29" },
  { seconds: 300, time: "11:59" },
  { seconds: 300, time: "13:29" },
  { seconds: 300, time: "14:59" },
  { seconds: 300, time: "16:29" },
  { seconds: 300, time: "17:29" },
  { seconds: 240, time: "19:29" },
  { seconds: 120, time: "20:59" },
  { seconds: 360, time: "00:00" },
  { seconds: 120, time: "01:59" },
  { seconds: 120, time: "03:59" },
].map((stage) => ({ ...stage, duration: stage.seconds * 1000 }));
const GAME_CYCLE_MS = GAME_STAGES.reduce((sum, stage) => sum + stage.duration, 0);
const mod = (n, m) => ((n % m) + m) % m;

function gameStageAt(positionMs) {
  const position = mod(positionMs, GAME_CYCLE_MS);
  let cursor = 0;
  for (let i = 0; i < GAME_STAGES.length; i++) {
    const stage = GAME_STAGES[i];
    if (position < cursor + stage.duration) {
      return { index: i, stage, offset: position - cursor };
    }
    cursor += stage.duration;
  }
  return { index: 0, stage: GAME_STAGES[0], offset: 0 };
}

const rings = [
  { element: $("ring-seconds"), circumference: 2 * Math.PI * 118 },
  { element: $("ring-minutes"), circumference: 2 * Math.PI * 94 },
  { element: $("ring-hours"), circumference: 2 * Math.PI * 70 },
];
rings.forEach(({ element, circumference }) => { element.style.strokeDasharray = circumference; });
let S = null, at = 0, filled = false, pw = "", gameStageDirty = false;
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
  "> POST " + location.origin + "/api/adjust",
  "  Body: { 'seconds': 1 } // maju, -1 // mundur",
  "> POST " + location.origin + "/api/duration",
  "  Body: { 'seconds': 60 }", "",
  "GAME TIME", "> POST " + location.origin + "/api/game/start",
  "> POST " + location.origin + "/api/game/stop",
  "> POST " + location.origin + "/api/game/reset",
  "> POST " + location.origin + "/api/game/stage",
  "  Body: { 'stage': 1 }",
  "> POST " + location.origin + "/api/game/adjust",
  "  Body: { 'seconds': 1 } // maju, -1 // mundur",
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
    if (d.game_time) {
      $("gameStart").disabled = d.game_time.running;
      $("gameStop").disabled = !d.game_time.running;
      $("gameStatus").textContent = d.game_time.running ? "Berjalan" : "Berhenti";
      $("gameStatus").classList.toggle("game-running", d.game_time.running);
      if (!gameStageDirty || path === "/api/game/stage") {
        $("gameStageSelect").value = String(d.game_time.stage);
      }
      if (path === "/api/game/stage") {
        gameStageDirty = false;
        $("msg").textContent = "Game Time dipindah ke Stage #" + d.game_time.stage + " · " + d.game_time.game_time;
      }
    }
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
    const cycle = Math.floor(e / S.duration_ms) + 1;
    $("state").textContent = S.running ? "Berjalan" : "Berhenti";
    $("meta").textContent = "PUTARAN " + cycle + " · " + (S.running ? "LIVE" : "PAUSED");

    if (S.game_time) {
      const gamePosition = S.game_time.position_ms + (S.game_time.running ? performance.now() - at : 0);
      const current = gameStageAt(gamePosition);
      const remainingMs = current.stage.duration - current.offset;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const remainingMinutes = Math.floor(remainingSeconds / 60);
      const remainingSecs = remainingSeconds % 60;
      const stageMinutes = Math.floor(current.stage.seconds / 60);
      const stageSecs = current.stage.seconds % 60;
      const next = GAME_STAGES[(current.index + 1) % GAME_STAGES.length];
      const progress = Math.min(Math.max(current.offset / current.stage.duration, 0), 1);

      $("gameTime").textContent = current.stage.time;
      $("gameStage").textContent = "STAGE #" + (current.index + 1);
      $("gameRemaining").textContent = pad(remainingMinutes) + ":" + pad(remainingSecs);
      $("gameDuration").textContent = "Durasi " + pad(stageMinutes) + ":" + pad(stageSecs);
      $("gameNext").textContent = "Next " + next.time;
      $("gameProgress").style.width = (progress * 100) + "%";
      $("gameStatus").textContent = S.game_time.running ? "Berjalan" : "Berhenti";
      $("gameStatus").classList.toggle("game-running", S.game_time.running);
    }
  }
  requestAnimationFrame(tick);
}
$("start").onclick = () => call("/api/start", { method: "POST" });
$("stop").onclick = () => call("/api/stop", { method: "POST" });
$("reset").onclick = () => call("/api/reset", { method: "POST" });
function adjust(seconds) {
  call("/api/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds }),
  });
}
$("back10").onclick = () => adjust(-10);
$("back1").onclick = () => adjust(-1);
$("forward1").onclick = () => adjust(1);
$("forward10").onclick = () => adjust(10);

$("gameStart").onclick = () => call("/api/game/start", { method: "POST" });
$("gameStop").onclick = () => call("/api/game/stop", { method: "POST" });
$("gameReset").onclick = () => call("/api/game/reset", { method: "POST" });
$("gameStageSelect").addEventListener("change", () => {
  gameStageDirty = true;
});
$("gameSetStage").onclick = () => {
  const selected = $("gameStageSelect").value;
  const stage = Number(selected);
  call("/api/game/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
};
function adjustGame(seconds) {
  call("/api/game/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds }),
  });
}
$("gameBack10").onclick = () => adjustGame(-10);
$("gameBack1").onclick = () => adjustGame(-1);
$("gameForward1").onclick = () => adjustGame(1);
$("gameForward10").onclick = () => adjustGame(10);

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
setInterval(() => {
  if (!document.hidden) call("/api/time");
}, 60000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) call("/api/time");
});
tick();
</script>
</body>
</html>`;
