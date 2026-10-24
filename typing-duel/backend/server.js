const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const CHARS = require('./characters'), randomWords = require('random-words');
const PORT = process.env.PORT || 8204;
const STATIC = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR); // optional: local testing only
const MAX_HP = 100, DMG = 12, GRACE = 700, COUNTDOWN = 3000, PAUSE = 3000, ROUND_TIMEOUT = 45000;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.png': 'image/png' };
const rooms = new Map();
const chance = p => !!p && Math.random() < p;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bc = (r, o) => r.players.forEach(p => send(p.ws, o));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/typing-duel/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (STATIC) {
    const f = path.join(STATIC, url === '/' ? 'index.html' : url);
    if (f.startsWith(STATIC) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: '/typing-duel/api/ws', maxPayload: 2048 });

wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join' && !ws.room) join(ws, m);
    else if (m.type === 'done' && ws.room) done(ws, m);
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);

function join(ws, m) {
  const code = String(m.room || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
  if (!code) return send(ws, { type: 'error', msg: 'Kode room tidak valid.' });
  let r = rooms.get(code);
  if (!r) rooms.set(code, r = { code, players: [], state: 'wait', round: 0, results: [], used: [] });
  if (r.players.length >= 2) return send(ws, { type: 'error', msg: 'Room sudah penuh.' });
  if (!CHARS[m.char]) return send(ws, { type: 'error', msg: 'Karakter tidak dikenal server.' });
  const char = m.char;
  const name = String(m.name || '').trim().slice(0, 16) || 'Player ' + (r.players.length + 1);
  r.players.push({ ws, name, char, hp: MAX_HP, noHit: 0 });
  ws.room = r; ws.slot = r.players.length - 1;
  send(ws, { type: 'joined', slot: ws.slot, room: code });
  if (r.players.length === 2) {
    bc(r, { type: 'start', max: MAX_HP, players: r.players.map(p => ({ name: p.name, char: p.char, hp: p.hp })) });
    nextRound(r);
  }
}

function pickWord(r) {
  let w;
  do { w = randomWords({ exactly: 1, maxLength: 9 })[0]; }
  while (w.length < 5 || !/^[a-z]+$/.test(w) || r.used.includes(w));
  r.used.push(w);
  return w;
}

function nextRound(r) {
  if (!rooms.has(r.code)) return;
  r.word = pickWord(r);
  r.round++; r.results = [null, null]; r.state = 'play';
  // Flashbang is rolled every round. flash[i] = player i gets flashed by the opponent's character.
  const flash = [
    chance(CHARS[r.players[1].char].flash),
    chance(CHARS[r.players[0].char].flash)
  ];
  bc(r, { type: 'round', round: r.round, word: r.word, countdown: COUNTDOWN, flash });
  r.timer = setTimeout(() => nextRound(r), COUNTDOWN + ROUND_TIMEOUT); // nobody finished: new word
}

// Time is measured on the client (word shown -> last key). Server only compares.
function done(ws, m) {
  const r = ws.room, t = Number(m.time);
  if (r.state !== 'play' || m.round !== r.round || r.results[ws.slot] != null) return;
  if (!isFinite(t) || t < r.word.length * 30) return; // physically implausible -> ignore
  r.results[ws.slot] = t;
  if (r.results[0] != null && r.results[1] != null) resolve(r);
  else if (!r.grace) r.grace = setTimeout(() => resolve(r), GRACE); // wait briefly for the other client's time
}

function resolve(r) {
  clearTimeout(r.grace); clearTimeout(r.timer); r.grace = null; r.state = 'result';
  const [a, b] = r.results;
  const w = a == null ? 1 : b == null ? 0 : (a <= b ? 0 : 1);
  const att = r.players[w], def = r.players[1 - w], ca = CHARS[att.char], cd = CHARS[def.char];
  const ev = []; let dmg = DMG;
  const hit = [0, 0]; // damage actually taken per slot
  if (chance(ca.crit)) { dmg *= 2; ev.push({ t: 'crit', slot: w }); }
  if (chance(cd.immune)) { ev.push({ t: 'immune', slot: 1 - w }); }
  else if (chance(cd.reflect)) { // damage is split 50/50: defender still takes damage, attacker shares it
    const half = Math.round(dmg / 2);
    hit[1 - w] = half; hit[w] = half;
    ev.push({ t: 'reflect', slot: 1 - w });
  }
  else hit[1 - w] = dmg;
  r.players.forEach((p, i) => {
    if (hit[i] > 0) { p.hp = Math.max(0, p.hp - hit[i]); p.noHit = 0; } else p.noHit++;
    const h = CHARS[p.char].heal;
    if (h && p.hp > 0 && p.noHit >= h.after) { p.hp = Math.min(MAX_HP, p.hp + h.amount); p.noHit = 0; ev.push({ t: 'heal', slot: i, v: h.amount }); }
  });
  bc(r, { type: 'result', winner: w, hit, ev, hp: r.players.map(p => p.hp), times: r.results });
  const d0 = r.players[0].hp <= 0, d1 = r.players[1].hp <= 0;
  if (d0 || d1) {
    const winner = d0 && d1 ? w : d0 ? 1 : 0; // both KO'd by a split: the faster typer wins
    r.state = 'over';
    setTimeout(() => { bc(r, { type: 'over', winner }); rooms.delete(r.code); }, 2200);
  }
  else setTimeout(() => nextRound(r), PAUSE);
}

function leave(ws) {
  const r = ws.room; if (!r) return;
  clearTimeout(r.grace); clearTimeout(r.timer);
  if (rooms.get(r.code) === r) rooms.delete(r.code);
  r.players.forEach(p => { if (p.ws !== ws) send(p.ws, { type: 'left' }); });
}

server.listen(PORT, () => console.log('Typing Duel backend on :' + PORT));