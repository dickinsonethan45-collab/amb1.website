const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const LOGIN_USER = "Lunar3HP";
const LOGIN_PASS = "MrBlock12344";
const authSessions = new Set();

app.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  raw.split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k.trim()] = v.join("=").trim();
  });
  next();
});

function requireLogin(req, res, next) {
  if (req.path.startsWith("/v2/")) return next();
  if (req.path === "/login" || req.path === "/do-login") return next();
  if (req.path === "/session/create" || req.path === "/session/delete" || req.path === "/session/rename") return next();
  if (req.path === "/refresh-all" || req.path === "/clean-duplicates") return next();
  if (req.path === "/try-refresh" || req.path === "/update-tokens") return next();
  if (req.path === "/symbol-getter") return next();
  const token = req.cookies?.auth;
  if (token && authSessions.has(token)) return next();
  res.redirect("/login");
}
app.use(requireLogin);

const PORT = process.env.PORT || 3000;
const NAKAMA_SERVER = "https://animalcompany.us-east1.nakamacloud.io";
const SERVER_KEY = "6URuTSlDKKfYbuDW";
const SESSIONS_FILE = "./sessions.json";
let sessions = {};

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8"); } catch (e) { console.log(`[Save] Failed: ${e.message}`); }
}
function loadSessions() {
  try { const raw = fs.readFileSync(SESSIONS_FILE, "utf8"); sessions = JSON.parse(raw); console.log(`[Load] Loaded ${Object.keys(sessions).length} session(s).`); } catch { console.log("[Load] No sessions.json, starting fresh."); }
}
function getExp(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).exp; } catch { return 0; }
}
function isExpired(token) {
  if (!token) return true;
  return getExp(token) - Math.floor(Date.now() / 1000) <= 0;
}
async function tryRefresh(session) {
  if (!session.refresh_token) return { success: false };
  const tok = session.refresh_token;
  const attempts = [
    { ep: "/v2/account/session/refresh", auth: "Basic " + Buffer.from(`${SERVER_KEY}:`).toString("base64"), body: JSON.stringify({ token: tok, vars: { authID: "9d5dca5eb2674de2a2204e31f1f7a1f8", clientUserAgent: "SteamFrame 1.67.3.2345_6f43a8db", deviceID: "a8319933d25f331503835aa71ec12f55", loginType: "1234", idType: "1234" } }) },
    { ep: "/v2/session/refresh", auth: "Bearer " + tok, body: JSON.stringify({ token: tok }) },
  ];
  console.log(`[Refresh:${session.name||session.id}] Attempting refresh...`);
  for (const { ep, auth, body } of attempts) {
    try {
      const r = await fetch(`${NAKAMA_SERVER}${ep}`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": auth, "User-Agent": "UnityPlayer/6000.3.12f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)", "x-unity-version": "6000.3.12f1" }, body });
      const text = await r.text();
      console.log(`[Refresh:${session.name||session.id}] ${ep} → ${r.status}`);
      if (r.status === 200) {
        const data = JSON.parse(text);
        session.token = data.token; session.refresh_token = data.refresh_token; session.lastRefresh = Date.now();
        saveSessions();
        console.log(`[Refresh:${session.name||session.id}] ✓ Success via ${ep}`);
        return { success: true, endpoint: ep };
      }
    } catch (e) { console.log(`[Refresh:${session.name||session.id}] ${ep} error: ${e.message}`); }
  }
  return { success: false };
}

(async () => {
  loadSessions();
  for (const s of Object.values(sessions)) {
    if (s.refresh_token && isExpired(s.token)) await tryRefresh(s);
  }
})();

let refreshing = false;
setInterval(async () => {
  if (refreshing) return;
  refreshing = true;
  try {
    const threshold = Math.floor(Date.now() / 1000) + 60;
    for (const s of Object.values(sessions)) {
      if (!s.refresh_token) continue;
      if (!s.token || getExp(s.token) < threshold) await tryRefresh(s);
    }
  } finally { refreshing = false; }
}, 30 * 1000);

function findSession(clientId) {
  let s = sessions[clientId];
  if (!s) s = Object.values(sessions).find(sess => sess.name === clientId);
  if (!s) s = Object.values(sessions).find(sess => {
    try { return JSON.parse(Buffer.from(sess.token.split(".")[1], "base64").toString()).uid === clientId; } catch { return false; }
  });
  if (!s) s = Object.values(sessions)[0];
  return s || null;
}

// ── PAGES ──────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "index.html")); });

const BG_SCRIPT = `
<script>
(function(){
  const c = document.getElementById('bg');
  const x = c.getContext('2d');
  let W,H,t=0,mx=-1,my=-1,smx,smy;
  function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight;if(smx==null){smx=W/2;smy=H/2;}}
  resize(); window.addEventListener('resize',resize);
  document.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;});
  const stars=Array.from({length:120},()=>({x:Math.random(),y:Math.random(),s:Math.random()*1.4+0.3,sp:Math.random()*0.0004+0.0001,o:Math.random()*0.6+0.2,flicker:Math.random()*Math.PI*2}));
  const blobs=[{bx:.15,by:.25,h:260,r:420,spd:.0011},{bx:.75,by:.15,h:290,r:360,spd:.0008},{bx:.5,by:.6,h:200,r:400,spd:.0013},{bx:.1,by:.8,h:320,r:300,spd:.0009},{bx:.85,by:.7,h:240,r:340,spd:.0007},{bx:.6,by:.05,h:280,r:280,spd:.0012}];
  const shoots=[];
  function spawnShoot(){if(shoots.length>4)return;shoots.push({x:Math.random()*W,y:Math.random()*H*.4,vx:4+Math.random()*6,vy:2+Math.random()*4,life:1,maxLife:60+Math.random()*40});}
  setInterval(spawnShoot,2200);
  function draw(){
    x.clearRect(0,0,W,H);
    const bg=x.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#00000f');bg.addColorStop(0.4,'#05001a');bg.addColorStop(1,'#000008');x.fillStyle=bg;x.fillRect(0,0,W,H);
    if(mx>=0){smx+=(mx-smx)*.05;smy+=(my-smy)*.05;}else{smx=W/2;smy=H/2;}
    blobs.forEach((b,i)=>{const nx=(b.bx+Math.sin(t*b.spd+i)*0.09)*W;const ny=(b.by+Math.cos(t*b.spd*1.3+i)*0.07)*H;const dx=smx-nx,dy=smy-ny;const dist=Math.sqrt(dx*dx+dy*dy);const pull=Math.max(0,1-dist/(W*.55));const fx=nx+dx*pull*.14,fy=ny+dy*pull*.14;const rad=b.r*(1+pull*.2)*(1+.04*Math.sin(t*b.spd*2+i));const g=x.createRadialGradient(fx,fy,0,fx,fy,rad);const a=.055+pull*.02;g.addColorStop(0,\`hsla(\${b.h},100%,55%,\${a})\`);g.addColorStop(.5,\`hsla(\${b.h+30},80%,45%,\${a*.4})\`);g.addColorStop(1,'transparent');x.fillStyle=g;x.fillRect(0,0,W,H);});
    stars.forEach(s=>{const px=((s.x*W+(t*s.sp*W))%W+W)%W;const py=s.y*H;const flicker=s.o*(0.7+0.3*Math.sin(t*.05+s.flicker));const pull=Math.max(0,1-Math.sqrt((smx-px)**2+(smy-py)**2)/250);x.beginPath();x.arc(px,py,s.s*(1+pull*.8),0,Math.PI*2);x.fillStyle=\`rgba(255,255,255,\${flicker+pull*.4})\`;x.fill();if(s.s>1&&Math.sin(t*.03+s.flicker)>.7){x.beginPath();x.arc(px,py,s.s*2.5,0,Math.PI*2);x.fillStyle=\`rgba(180,160,255,\${flicker*.3})\`;x.fill();}});
    for(let i=shoots.length-1;i>=0;i--){const s=shoots[i];s.x+=s.vx;s.y+=s.vy;s.life--;if(s.life<=0){shoots.splice(i,1);continue;}const alpha=s.life/s.maxLife;const len=18+s.vx*3;const g=x.createLinearGradient(s.x-s.vx*len,s.y-s.vy*len,s.x,s.y);g.addColorStop(0,'transparent');g.addColorStop(1,\`rgba(255,255,255,\${alpha})\`);x.strokeStyle=g;x.lineWidth=1.5;x.beginPath();x.moveTo(s.x-s.vx*len,s.y-s.vy*len);x.lineTo(s.x,s.y);x.stroke();}
    t++;requestAnimationFrame(draw);
  }
  draw();
})();
<\/script>`;

app.get("/login", (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AC Auth</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:'Inter',sans-serif;background:#00000f}
#bg{position:fixed;inset:0;z-index:0}
.center{position:relative;z-index:2;min-height:100vh;display:flex;align-items:center;justify-content:center}
.box{width:380px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:28px;padding:52px 44px;backdrop-filter:blur(30px);box-shadow:0 0 0 1px rgba(255,255,255,0.03),0 40px 100px rgba(0,0,0,.8)}
.icon{width:64px;height:64px;margin:0 auto 24px;background:linear-gradient(135deg,#a855f7,#ec4899,#f97316);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 0 40px rgba(168,85,247,0.4),0 8px 32px rgba(0,0,0,0.5);animation:glow 3s ease-in-out infinite}
@keyframes glow{0%,100%{box-shadow:0 0 40px rgba(168,85,247,0.4)}50%{box-shadow:0 0 60px rgba(168,85,247,0.7),0 0 80px rgba(236,72,153,0.3)}}
h1{text-align:center;font-size:24px;font-weight:900;color:#fff;margin-bottom:4px}
h1 span{background:linear-gradient(90deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{text-align:center;font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:3px;text-transform:uppercase;margin-bottom:36px}
.field{margin-bottom:12px}
.field input{width:100%;background:rgba(255,255,255,0.05);color:#fff;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:15px 18px;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:all .2s}
.field input::placeholder{color:rgba(255,255,255,0.2)}
.field input:focus{border-color:rgba(168,85,247,0.5);background:rgba(168,85,247,0.08);box-shadow:0 0 0 3px rgba(168,85,247,0.12)}
.btn{width:100%;margin-top:6px;padding:16px;background:linear-gradient(135deg,#a855f7,#ec4899);border:none;border-radius:14px;color:#fff;font-family:'Inter',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 4px 24px rgba(168,85,247,0.4)}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 40px rgba(168,85,247,0.6)}
.btn:active{transform:none}
.err{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;font-size:12px;padding:11px 14px;border-radius:12px;margin-bottom:14px;text-align:center;animation:shake .35s}
@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
</style></head><body>
<canvas id="bg"></canvas>
<div class="center"><div class="box">
  <div class="icon">⚡</div>
  <h1>AC Auth <span>Backend</span></h1>
  <div class="sub">by Lunar3HP</div>
  ${req.query.err ? '<div class="err">Wrong credentials. Try again.</div>' : ''}
  <form method="POST" action="/do-login">
    <div class="field"><input name="username" placeholder="Username" autocomplete="off" required></div>
    <div class="field"><input type="password" name="password" placeholder="Password" required></div>
    <button class="btn" type="submit">Sign In</button>
  </form>
</div></div>
${BG_SCRIPT}
</body></html>`);
});

app.post("/do-login", (req, res) => {
  const { username, password } = req.body;
  if (username === LOGIN_USER && password === LOGIN_PASS) {
    const token = crypto.randomBytes(32).toString("hex");
    authSessions.add(token);
    res.setHeader("Set-Cookie", `auth=${token}; Path=/; HttpOnly`);
    res.redirect("/");
  } else { res.redirect("/login?err=1"); }
});

app.post("/logout", (req, res) => {
  const token = req.cookies?.auth;
  if (token) authSessions.delete(token);
  res.setHeader("Set-Cookie", "auth=; Path=/; Max-Age=0");
  res.redirect("/login");
});

// ── SESSION CRUD ───────────────────────────────────────────────────────────────
app.post("/session/create", (req, res) => {
  const id = crypto.randomBytes(8).toString("hex");
  const { name, token, refresh_token } = req.body;
  sessions[id] = { id, name: name || id, token: token?.trim() || "", refresh_token: refresh_token?.trim() || "", connections: 0 };
  saveSessions();
  console.log(`[Create] ${name || id}`);
  if (req.headers["accept"]?.includes("application/json")) return res.json({ ok: true, id });
  res.redirect("/");
});
app.post("/session/:id/update", (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: "Not found" });
  if (req.body.token) s.token = req.body.token.trim();
  if (req.body.refresh_token) s.refresh_token = req.body.refresh_token.trim();
  saveSessions();
  if (req.body._from === "ui") return res.redirect("/");
  res.json({ ok: true });
});
app.post("/session/:id/rename", (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: "Not found" });
  s.name = req.body.name?.trim() || s.name;
  saveSessions();
  res.redirect("/");
});
app.post("/session/:id/refresh", async (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: "Not found" });
  await tryRefresh(s);
  res.redirect("/");
});
app.post("/session/:id/delete", (req, res) => {
  delete sessions[req.params.id];
  saveSessions();
  if (req.headers["accept"]?.includes("application/json")) return res.json({ ok: true });
  res.redirect("/");
});
app.post("/refresh-all", async (req, res) => {
  for (const s of Object.values(sessions)) await tryRefresh(s);
  if (req.headers["accept"]?.includes("application/json")) return res.json({ ok: true });
  res.redirect("/");
});
app.post("/clean-duplicates", (req, res) => {
  const seen = new Map();
  for (const [id, s] of Object.entries(sessions)) {
    const key = s.refresh_token || id;
    if (seen.has(key)) delete sessions[id];
    else seen.set(key, id);
  }
  saveSessions();
  res.redirect("/");
});

// ── API ────────────────────────────────────────────────────────────────────────
app.get("/v2/account/authenticate/custom/:client", (req, res) => {
  const s = findSession(req.params.client);
  if (s) { console.log(`[Auth:GET] ${req.params.client} → ${s.name || s.id}`); return res.json({ token: s.token, refresh_token: s.refresh_token, created: false }); }
  res.json({ token: "", refresh_token: "", created: false });
});
app.post("/v2/account/authenticate/custom/:client", (req, res) => {
  const s = findSession(req.params.client);
  if (s) { s.connections = (s.connections || 0) + 1; saveSessions(); console.log(`[Auth:POST] ${req.params.client} → ${s.name || s.id}`); return res.json({ token: s.token, refresh_token: s.refresh_token, created: false }); }
  res.json({ token: "", refresh_token: "", created: false });
});
app.post("/v2/account/authenticate/refresh", (req, res) => {
  const first = Object.values(sessions)[0];
  res.json({ token: first?.token || "", refresh_token: first?.refresh_token || "", created: false });
});
app.get("/v2/account", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  let s = bearerToken ? Object.values(sessions).find(s => s.token === bearerToken) : null;
  if (!s) s = Object.values(sessions).find(s => !isExpired(s.token));
  if (!s) return res.status(401).json({ error: "No valid session" });
  try { const u = await fetch(`${NAKAMA_SERVER}/v2/account`, { headers: { "Authorization": `Bearer ${s.token}`, "User-Agent": "UnityPlayer/6000.3.12f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)", "x-unity-version": "6000.3.12f1" } }); res.json(await u.json()); }
  catch (e) { res.status(500).json({}); }
});
app.post("/v2/account", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  let s = bearerToken ? Object.values(sessions).find(s => s.token === bearerToken) : null;
  if (!s) s = Object.values(sessions).find(s => !isExpired(s.token));
  if (!s) return res.status(401).json({ error: "No valid session" });
  try { const u = await fetch(`${NAKAMA_SERVER}/v2/account`, { headers: { "Authorization": `Bearer ${s.token}`, "User-Agent": "UnityPlayer/6000.3.12f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)", "x-unity-version": "6000.3.12f1" } }); res.json(await u.json()); }
  catch (e) { res.status(500).json({}); }
});
app.post("/update-tokens", (req, res) => {
  const { token, refresh_token, id } = req.body;
  if (!token || !refresh_token) return res.status(400).json({ error: "token and refresh_token required" });
  const target = (id && sessions[id]) ? sessions[id] : Object.values(sessions)[0];
  if (!target) return res.status(404).json({ error: "No session found" });
  target.token = token; target.refresh_token = refresh_token; saveSessions();
  res.json({ ok: true });
});
app.get("/try-refresh", async (req, res) => {
  const results = {};
  for (const s of Object.values(sessions)) results[s.id] = await tryRefresh(s);
  res.json(results);
});

// ── SYMBOL GETTER ──────────────────────────────────────────────────────────────
app.get("/symbol-getter", (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Symbol Getter</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--pp:#a855f7;--pk:#ec4899;--or:#f97316;--pp-dim:rgba(168,85,247,0.12);--border:rgba(255,255,255,0.07);--border-hi:rgba(255,255,255,0.14);--bg0:#00000f;--bg1:rgba(255,255,255,0.025);--bg2:rgba(255,255,255,0.04);--text:#e8e0ff;--muted:rgba(200,180,255,0.35);--mono:'JetBrains Mono',monospace;--success:#50fa7b;--danger:#ff5555}
html,body{min-height:100%;background:var(--bg0);font-family:'Inter',sans-serif;color:var(--text)}
#bg{position:fixed;inset:0;z-index:0;pointer-events:none}
.page{position:relative;z-index:1;max-width:1020px;margin:0 auto;padding-bottom:80px}
.hdr{display:flex;align-items:center;gap:14px;padding:18px 28px;border-bottom:1px solid var(--border);background:rgba(0,0,10,0.55);backdrop-filter:blur(20px);position:sticky;top:0;z-index:100}
.hdr-logo{width:38px;height:38px;background:linear-gradient(135deg,var(--pp),var(--pk),var(--or));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 24px rgba(168,85,247,0.5);animation:logopulse 4s ease-in-out infinite;flex-shrink:0}
@keyframes logopulse{0%,100%{box-shadow:0 0 24px rgba(168,85,247,0.5)}50%{box-shadow:0 0 40px rgba(168,85,247,0.8),0 0 60px rgba(236,72,153,0.3)}}
.hdr-name{font-size:18px;font-weight:900;color:#fff;letter-spacing:-.5px}
.hdr-name em{font-style:normal;background:linear-gradient(90deg,var(--pp),var(--pk));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.made-by{display:flex;align-items:center;gap:7px;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(236,72,153,0.1));border:1px solid rgba(168,85,247,0.35);border-radius:100px;padding:5px 14px 5px 10px;position:relative;overflow:hidden}
.made-by::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(168,85,247,0.08),transparent);animation:shimmer 2.5s linear infinite}
@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.made-by-dot{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,var(--pp),var(--pk));box-shadow:0 0 8px rgba(168,85,247,0.8);animation:dotpulse 2s ease-in-out infinite;flex-shrink:0}
@keyframes dotpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.7)}}
.made-by-text{font-size:11px;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,#c084fc,#f472b6,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;white-space:nowrap}
.hdr-nav{display:flex;gap:4px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:12px;padding:4px}
.hnav-btn{font-size:11px;font-weight:700;padding:6px 14px;border-radius:8px;color:var(--muted);text-decoration:none;transition:all .15s;letter-spacing:.2px}
.hnav-btn:hover{color:var(--text);background:rgba(255,255,255,0.06)}
.hnav-active{background:linear-gradient(135deg,var(--pp),var(--pk))!important;color:#fff!important;box-shadow:0 2px 12px rgba(168,85,247,0.4)}
.hdr-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.hdr-clock{font-size:12px;color:var(--muted);font-family:var(--mono);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 12px}
.abtn{border:none;padding:9px 16px;cursor:pointer;font-weight:700;font-size:12px;border-radius:10px;font-family:'Inter',sans-serif;transition:all .15s;letter-spacing:.2px;white-space:nowrap}
.abtn:hover{transform:translateY(-1px);filter:brightness(1.1)}
.abtn-ghost{background:var(--bg2);color:var(--pp);border:1px solid rgba(168,85,247,0.25)}
.abtn-ghost:hover{background:var(--pp-dim)}
.sg-wrap{padding:32px 28px}
.sg-title{font-size:26px;font-weight:900;color:#fff;letter-spacing:-.5px;margin-bottom:6px}
.sg-sub{font-size:13px;color:var(--muted);margin-bottom:28px}
.drop-zone{border:1.5px dashed var(--border-hi);border-radius:18px;padding:3.5rem 2rem;text-align:center;cursor:pointer;transition:background .15s,border-color .15s;margin-bottom:1.5rem;user-select:none;background:var(--bg1)}
.drop-zone:hover,.drop-zone.drag{background:rgba(168,85,247,0.06);border-color:rgba(168,85,247,0.4)}
.drop-zone svg{width:36px;height:36px;color:var(--muted);display:block;margin:0 auto 14px}
.dz-title{font-size:15px;font-weight:600;color:var(--text)}
.dz-hint{font-size:13px;color:var(--muted);margin-top:5px}
#file-input{display:none}
.progress{height:2px;background:rgba(255,255,255,0.05);border-radius:2px;margin-bottom:1rem;display:none;overflow:hidden}
.progress.show{display:block}
.progress-bar{height:100%;width:0%;background:linear-gradient(90deg,var(--pp),var(--pk));border-radius:2px;transition:width .3s}
.sstatus{font-size:12px;color:var(--muted);margin-bottom:1.25rem;display:none;font-family:var(--mono)}
.sstatus.show{display:block}
.sstatus.err{color:var(--danger)}
.sstatus.ok{color:var(--success)}
.outputs{display:flex;flex-direction:column;gap:14px}
.out-card{background:var(--bg1);border:1px solid var(--border);border-radius:18px;overflow:hidden;display:none}
.out-card.show{display:block}
.out-header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border);background:rgba(255,255,255,0.02)}
.out-header-left{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;font-family:var(--mono);color:#fff}
.badge{font-size:11px;padding:2px 10px;border-radius:99px;background:var(--pp-dim);color:var(--pp);border:1px solid rgba(168,85,247,0.25);font-family:'Inter',sans-serif}
.dl-btn{display:flex;align-items:center;gap:6px;font-size:12px;font-family:'Inter',sans-serif;padding:6px 16px;border-radius:9px;border:1px solid var(--border-hi);background:transparent;color:var(--text);cursor:pointer;transition:background .12s;font-weight:600}
.dl-btn:hover{background:var(--pp-dim);border-color:rgba(168,85,247,0.35);color:var(--pp)}
pre{padding:18px;font-size:11px;color:rgba(200,180,255,0.5);font-family:var(--mono);overflow:auto;max-height:240px;line-height:1.7;white-space:pre;background:rgba(0,0,0,0.3)}
</style></head><body>
<canvas id="bg"></canvas>
<div class="page">
<div class="hdr">
  <div class="hdr-logo">⚡</div>
  <div class="hdr-name">AC Auth <em>Backend</em></div>
  <div class="made-by"><div class="made-by-dot"></div><div class="made-by-text">Made by Lunar3HP</div></div>
  <nav class="hdr-nav">
    <a href="/" class="hnav-btn">Sessions</a>
    <a href="/symbol-getter" class="hnav-btn hnav-active">Symbol Getter</a>
  </nav>
  <div class="hdr-r">
    <div class="hdr-clock" id="clock"></div>
    <form method="POST" action="/logout" style="display:inline"><button type="submit" class="abtn abtn-ghost" style="padding:7px 14px;font-size:11px">Sign Out</button></form>
  </div>
</div>
<div class="sg-wrap">
  <div class="sg-title">Symbol Getter</div>
  <div class="sg-sub">Get symbols from libil2cpp.so — processed in your browser</div>
  <div class="drop-zone" id="dz"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><div class="dz-title">Drop libil2cpp.so here</div><div class="dz-hint">or click to browse</div></div>
  <input type="file" id="file-input" accept=".so">
  <div class="progress" id="prog"><div class="progress-bar" id="prog-bar"></div></div>
  <div class="sstatus" id="status"></div>
  <div class="outputs">
    <div class="out-card" id="card-json"><div class="out-header"><div class="out-header-left">SymbolMap.json <span class="badge" id="cnt">0</span></div><button class="dl-btn" onclick="dl('SymbolMap.json','json')">Download</button></div><pre id="pre-json"></pre></div>
    <div class="out-card" id="card-headers"><div class="out-header"><div class="out-header-left">Il2Cpp-Headers.hpp</div><button class="dl-btn" onclick="dl('Il2Cpp-Headers.hpp','headers')">Download</button></div><pre id="pre-headers"></pre></div>
    <div class="out-card" id="card-method"><div class="out-header"><div class="out-header-left">Il2CppMethodNames.hpp</div><button class="dl-btn" onclick="dl('Il2CppMethodNames.hpp','method')">Download</button></div><pre id="pre-method"></pre></div>
    <div class="out-card" id="card-frida"><div class="out-header"><div class="out-header-left">Frida-Map.js</div><button class="dl-btn" onclick="dl('Frida-Map.js','frida')">Download</button></div><pre id="pre-frida"></pre></div>
  </div>
</div>
</div>
<script>
const IL2CPP_API=["il2cpp_init","il2cpp_init_utf16","il2cpp_shutdown","il2cpp_set_config_dir","il2cpp_set_data_dir","il2cpp_set_temp_dir","il2cpp_set_commandline_arguments","il2cpp_set_commandline_arguments_utf16","il2cpp_set_config_utf16","il2cpp_set_config","il2cpp_set_memory_callbacks","il2cpp_memory_pool_set_region_size","il2cpp_memory_pool_get_region_size","il2cpp_get_corlib","il2cpp_add_internal_call","il2cpp_resolve_icall","il2cpp_alloc","il2cpp_free","il2cpp_array_class_get","il2cpp_array_length","il2cpp_array_get_byte_length","il2cpp_array_new","il2cpp_array_new_specific","il2cpp_array_new_full","il2cpp_bounded_array_class_get","il2cpp_array_element_size","il2cpp_assembly_get_image","il2cpp_class_enum_basetype","il2cpp_class_from_system_type","il2cpp_class_is_inited","il2cpp_class_is_generic","il2cpp_class_is_inflated","il2cpp_class_is_assignable_from","il2cpp_class_is_subclass_of","il2cpp_class_has_parent","il2cpp_class_from_il2cpp_type","il2cpp_class_from_name","il2cpp_class_get_element_class","il2cpp_class_get_events","il2cpp_class_get_fields","il2cpp_class_get_nested_types","il2cpp_class_get_interfaces","il2cpp_class_get_properties","il2cpp_class_get_property_from_name","il2cpp_class_get_field_from_name","il2cpp_class_get_methods","il2cpp_class_get_method_from_name","il2cpp_class_get_name","il2cpp_class_get_namespace","il2cpp_class_get_parent","il2cpp_class_get_declaring_type","il2cpp_class_instance_size","il2cpp_class_num_fields","il2cpp_class_is_valuetype","il2cpp_class_is_blittable","il2cpp_class_value_size","il2cpp_class_get_flags","il2cpp_class_is_abstract","il2cpp_class_is_interface","il2cpp_class_array_element_size","il2cpp_class_from_type","il2cpp_class_get_type","il2cpp_class_get_type_token","il2cpp_class_has_attribute","il2cpp_class_has_references","il2cpp_class_is_enum","il2cpp_class_get_image","il2cpp_class_get_assemblyname","il2cpp_class_get_rank","il2cpp_class_get_data_size","il2cpp_class_get_static_field_data","il2cpp_stats_dump_to_file","il2cpp_stats_get_value","il2cpp_domain_get","il2cpp_domain_assembly_open","il2cpp_domain_get_assemblies","il2cpp_raise_exception","il2cpp_exception_from_name_msg","il2cpp_get_exception_argument_null","il2cpp_format_exception","il2cpp_format_stack_trace","il2cpp_unhandled_exception","il2cpp_native_stack_trace","il2cpp_field_get_name","il2cpp_field_get_flags","il2cpp_field_get_from_reflection","il2cpp_field_get_parent","il2cpp_field_get_object","il2cpp_field_get_offset","il2cpp_field_get_type","il2cpp_field_get_value","il2cpp_field_get_value_object","il2cpp_field_has_attribute","il2cpp_field_set_value","il2cpp_field_set_value_object","il2cpp_field_static_get_value","il2cpp_field_static_set_value","il2cpp_field_is_literal","il2cpp_gc_collect","il2cpp_gc_collect_a_little","il2cpp_gc_start_incremental_collection","il2cpp_gc_enable","il2cpp_gc_disable","il2cpp_gc_is_disabled","il2cpp_gc_set_mode","il2cpp_gc_is_incremental","il2cpp_gc_get_max_time_slice_ns","il2cpp_gc_set_max_time_slice_ns","il2cpp_gc_get_used_size","il2cpp_gc_get_heap_size","il2cpp_gc_foreach_heap","il2cpp_stop_gc_world","il2cpp_start_gc_world","il2cpp_gc_alloc_fixed","il2cpp_gc_free_fixed","il2cpp_gchandle_new","il2cpp_gchandle_new_weakref","il2cpp_gchandle_get_target","il2cpp_gchandle_foreach_get_target","il2cpp_gc_wbarrier_set_field","il2cpp_gc_has_strict_wbarriers","il2cpp_gc_set_external_allocation_tracker","il2cpp_gc_set_external_wbarrier_tracker","il2cpp_gchandle_free","il2cpp_object_header_size","il2cpp_array_object_header_size","il2cpp_offset_of_array_length_in_array_object_header","il2cpp_offset_of_array_bounds_in_array_object_header","il2cpp_allocation_granularity","il2cpp_unity_liveness_allocate_struct","il2cpp_unity_liveness_calculation_from_root","il2cpp_unity_liveness_calculation_from_statics","il2cpp_unity_liveness_finalize","il2cpp_unity_liveness_free_struct","il2cpp_method_get_return_type","il2cpp_method_get_from_reflection","il2cpp_method_get_object","il2cpp_method_get_name","il2cpp_method_is_generic","il2cpp_method_is_inflated","il2cpp_method_is_instance","il2cpp_method_get_param_count","il2cpp_method_get_param","il2cpp_method_get_class","il2cpp_method_has_attribute","il2cpp_method_get_declaring_type","il2cpp_method_get_flags","il2cpp_method_get_token","il2cpp_method_get_param_name","il2cpp_profiler_install","il2cpp_profiler_set_events","il2cpp_profiler_install_enter_leave","il2cpp_profiler_install_allocation","il2cpp_profiler_install_gc","il2cpp_profiler_install_fileio","il2cpp_profiler_install_thread","il2cpp_property_get_name","il2cpp_property_get_get_method","il2cpp_property_get_set_method","il2cpp_property_get_parent","il2cpp_property_get_flags","il2cpp_object_get_class","il2cpp_object_get_size","il2cpp_object_get_virtual_method","il2cpp_object_new","il2cpp_object_unbox","il2cpp_value_box","il2cpp_monitor_enter","il2cpp_monitor_try_enter","il2cpp_monitor_exit","il2cpp_monitor_pulse","il2cpp_monitor_pulse_all","il2cpp_monitor_wait","il2cpp_monitor_try_wait","il2cpp_runtime_invoke_convert_args","il2cpp_runtime_invoke","il2cpp_runtime_class_init","il2cpp_runtime_object_init","il2cpp_runtime_object_init_exception","il2cpp_runtime_unhandled_exception_policy_set","il2cpp_string_length","il2cpp_string_chars","il2cpp_string_new","il2cpp_string_new_wrapper","il2cpp_string_new_utf16","il2cpp_string_new_len","il2cpp_string_intern","il2cpp_string_is_interned","il2cpp_thread_current","il2cpp_thread_attach","il2cpp_thread_detach","il2cpp_is_vm_thread","il2cpp_current_thread_walk_frame_stack","il2cpp_thread_walk_frame_stack","il2cpp_current_thread_get_top_frame","il2cpp_thread_get_top_frame","il2cpp_current_thread_get_frame_at","il2cpp_thread_get_frame_at","il2cpp_current_thread_get_stack_depth","il2cpp_thread_get_stack_depth","il2cpp_set_default_thread_affinity","il2cpp_override_stack_backtrace","il2cpp_type_get_object","il2cpp_type_get_type","il2cpp_type_get_class_or_element_class","il2cpp_type_get_name","il2cpp_type_get_assembly_qualified_name","il2cpp_type_get_reflection_name","il2cpp_type_is_byref","il2cpp_type_get_attrs","il2cpp_type_equals","il2cpp_type_is_static","il2cpp_type_is_pointer_type","il2cpp_image_get_assembly","il2cpp_image_get_name","il2cpp_image_get_filename","il2cpp_image_get_entry_point","il2cpp_image_get_class_count","il2cpp_image_get_class","il2cpp_capture_memory_snapshot","il2cpp_free_captured_memory_snapshot","il2cpp_set_find_plugin_callback","il2cpp_register_log_callback","il2cpp_debugger_set_agent_options","il2cpp_is_debugger_attached","il2cpp_register_debugger_agent_transport","il2cpp_debug_foreach_method","il2cpp_debug_get_method_info","il2cpp_unity_install_unitytls_interface","il2cpp_custom_attrs_from_class","il2cpp_custom_attrs_from_method","il2cpp_custom_attrs_from_field","il2cpp_custom_attrs_has_attr","il2cpp_custom_attrs_get_attr","il2cpp_custom_attrs_construct","il2cpp_custom_attrs_free","il2cpp_type_get_name_chunked","il2cpp_class_set_userdata","il2cpp_class_get_userdata_offset","il2cpp_class_for_each","il2cpp_unity_set_android_network_up_state_func"];
const SKIP_RE=/^(_Z|SystemNative|Java_|pthread|__cxa|__start|__stop|NLSocket|ZStream|Flush|Dll[CG]|Globalization|JNI_|ReadEvents|mono_pal|__dynamic|__gxx|UnityAds|CloseN|CreateN)/;
let outputs={};
const dz=document.getElementById('dz'),fi=document.getElementById('file-input'),statusEl=document.getElementById('status'),progEl=document.getElementById('prog'),progBar=document.getElementById('prog-bar');
dz.addEventListener('click',()=>fi.click());
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');processFile(e.dataTransfer.files[0]);});
fi.addEventListener('change',()=>processFile(fi.files[0]));
function setStatus(m,c){statusEl.textContent=m;statusEl.className='sstatus show'+(c?' '+c:'');}
function setProgress(p){progEl.className='progress show';progBar.style.width=p+'%';if(p>=100)setTimeout(()=>{progEl.className='progress';},700);}
function r32(b,o){return((b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0);}
function r64(b,o){return r32(b,o+4)*0x100000000+r32(b,o);}
function r16(b,o){return b[o]|(b[o+1]<<8);}
function cstr(b,o){let s='';while(o<b.length&&b[o]!==0)s+=String.fromCharCode(b[o++]);return s;}
function extractObfSymbols(buf){
  if(buf[0]!==0x7f||buf[1]!==0x45||buf[2]!==0x4c||buf[3]!==0x46)throw new Error('Not an ELF file');
  const is64=buf[4]===2,entries=[];
  if(is64){const shoff=r64(buf,40),shentsz=r16(buf,58),shnum=r16(buf,60),secs=[];for(let i=0;i<shnum;i++){const b=Number(shoff)+i*shentsz;secs.push({type:r32(buf,b+4),off:r64(buf,b+24),size:r64(buf,b+32),link:r32(buf,b+40),entsz:r64(buf,b+56)});}for(const s of secs){if(s.type!==11&&s.type!==2)continue;const strsec=secs[s.link],esz=Number(s.entsz)||24,cnt=Math.floor(Number(s.size)/esz);for(let j=0;j<cnt;j++){const b=Number(s.off)+j*esz,nm=r32(buf,b),info=buf[b+4],shndx=r16(buf,b+6),addr=r64(buf,b+8),bind=info>>4;if(shndx!==0&&shndx!==0xfff1&&bind===1){const name=cstr(buf,Number(strsec.off)+nm);if(name&&!SKIP_RE.test(name)&&/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(name))entries.push({name,addr:Number(addr)});}}}
  }else{const shoff=r32(buf,32),shentsz=r16(buf,46),shnum=r16(buf,48),secs=[];for(let i=0;i<shnum;i++){const b=shoff+i*shentsz;secs.push({type:r32(buf,b+4),off:r32(buf,b+16),size:r32(buf,b+20),link:r32(buf,b+24),entsz:r32(buf,b+36)});}for(const s of secs){if(s.type!==11&&s.type!==2)continue;const strsec=secs[s.link],esz=s.entsz||16,cnt=Math.floor(s.size/esz);for(let j=0;j<cnt;j++){const b=s.off+j*esz,nm=r32(buf,b),addr=r32(buf,b+4),info=buf[b+12],shndx=r16(buf,b+14),bind=info>>4;if(shndx!==0&&shndx!==0xfff1&&bind===1){const name=cstr(buf,strsec.off+nm);if(name&&!SKIP_RE.test(name)&&/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(name))entries.push({name,addr});}}}
  entries.sort((a,b)=>a.addr-b.addr);return[...new Map(entries.map(e=>[e.name,e])).values()].sort((a,b)=>a.addr-b.addr).map(e=>e.name);
}
function buildMap(syms){const map={};const len=Math.min(syms.length,IL2CPP_API.length);for(let i=0;i<len;i++)map[IL2CPP_API[i]]=syms[i];return map;}
function ts(){return new Date().toLocaleString('en-US',{month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
function genJSON(map){const obj={"__header":"// Generated at "+ts()};for(const[k,v]of Object.entries(map))obj[k]=v;return JSON.stringify(obj,null,4);}
function genHeaders(map){let s="#pragma once\\n\\n// Generated at "+ts()+"\\n\\n";for(const[k,v]of Object.entries(map))s+="#define symbol_"+k+" \\""+v+"\\"\\n";return s;}
function genMethod(map){let s="#pragma once\\n\\n// Generated at "+ts()+"\\n\\n";for(const[k,v]of Object.entries(map))s+="#define BNM_IL2CPP_API_"+k+" \\""+v+"\\"\\n";return s;}
function genFrida(map){const entries=Object.entries(map);let s="// Generated at "+ts()+"\\n\\nIl2Cpp.$config.exports = {\\n";entries.forEach(([k,v],i)=>s+="    "+k+": () => Il2Cpp.module.findExportByName(\\""+v+"\\")"+((i<entries.length-1)?',':'')+"\\n");s+='};';return s;}
async function processFile(file){if(!file)return;if(!file.name.endsWith('.so')){setStatus('file must be .so','err');return;}setStatus('reading...');setProgress(10);const buf=new Uint8Array(await file.arrayBuffer());setProgress(40);setStatus('parsing ELF...');let syms;try{syms=extractObfSymbols(buf);}catch(e){setStatus('ELF error: '+e.message,'err');return;}setProgress(75);setStatus('found '+syms.length+' symbols — mapping...');const map=buildMap(syms),cnt=Object.keys(map).length;outputs.json=genJSON(map);outputs.headers=genHeaders(map);outputs.method=genMethod(map);outputs.frida=genFrida(map);setProgress(100);setStatus('done — '+cnt+' symbols','ok');document.getElementById('cnt').textContent=cnt+' symbols';document.getElementById('pre-json').textContent=outputs.json.slice(0,3000);document.getElementById('pre-headers').textContent=outputs.headers.slice(0,3000);document.getElementById('pre-method').textContent=outputs.method.slice(0,3000);document.getElementById('pre-frida').textContent=outputs.frida.slice(0,3000);['json','headers','method','frida'].forEach(id=>document.getElementById('card-'+id).classList.add('show'));}
function dl(f,k){if(!outputs[k])return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([outputs[k]],{type:'text/plain'}));a.download=f;a.click();}
(function tick(){document.getElementById('clock').textContent=new Date().toLocaleTimeString();setTimeout(tick,1000);})();
</script>
${BG_SCRIPT}
</body></html>`);
});

app.all("*", (req, res) => { res.status(200).json({}); });
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
