const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const CHARS = require('./characters'), randomWords = require('random-words');
const PORT = process.env.PORT || 8204;
const STATIC = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR); // optional: local testing only
// A round lasts ROUND_TIME ms of typing. It ends when both players finished, or when time runs out (+SLACK for late reports).
const MAX_HP = 100, DMG = 12, ROUND_TIME = 10000, SLACK = 600, COUNTDOWN = 3000, PAUSE = 3000;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.png': 'image/png' };
const rooms = new Map();
const chance = p => !!p && Math.random() < p;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bc = (r, o) => r.players.forEach(p => send(p.ws, o));
// Small status text shown next to the HP numbers (stacks / permanent bonus)
const badge = p => { const c = CHARS[p.char]; return c.stacks ? `✦ ${p.stacks}/${c.stacks.max}` : c.ramp ? `⚔ +${p.bonus}` : ''; };

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
    else if (m.type === 'typo' && ws.room) typo(ws, m);
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);

function join(ws, m) {
  const code = String(m.room || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase();
  if (!code) return send(ws, { type: 'error', msg: 'Kode room tidak valid.' });
  let r = rooms.get(code);
  if (!r) rooms.set(code, r = { code, players: [], state: 'wait', round: 0, results: [], firsts: [null, null], typos: [0, 0], flashUntil: [0, 0], used: [] });
  if (r.players.length >= 2) return send(ws, { type: 'error', msg: 'Room sudah penuh.' });
  if (!CHARS[m.char]) return send(ws, { type: 'error', msg: 'Karakter tidak dikenal server.' });
  const char = m.char;
  const name = String(m.name || '').trim().slice(0, 16) || 'Player ' + (r.players.length + 1);
  // bonus = permanent damage (Teio), stacks (Special Week), healAcc = HP healed since Gentildonna last countered, revived = Almond's one-time revive
  r.players.push({ ws, name, char, hp: MAX_HP, noHit: 0, bonus: 0, stacks: 0, healAcc: 0, revived: false, shield: CHARS[char].shield || 0 });
  ws.room = r; ws.slot = r.players.length - 1;
  send(ws, { type: 'joined', slot: ws.slot, room: code });
  if (r.players.length === 2) {
    bc(r, { type: 'start', max: MAX_HP, players: r.players.map(p => ({ name: p.name, char: p.char, hp: p.hp, shield: p.shield })), badge: r.players.map(badge) });
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
  r.round++; r.results = [null, null]; r.firsts = [null, null]; r.typos = [0, 0]; r.flashUntil = [0, 0]; r.state = 'play';
  // Start-of-round flashbang roll. flash[i] = duration in ms for player i (0 = none), from the opponent's character.
  const fl = c => chance(c.flash) ? (c.flashMs || 1000) : 0;
  const flash = [fl(CHARS[r.players[1].char]), fl(CHARS[r.players[0].char])];
  bc(r, { type: 'round', round: r.round, word: r.word, countdown: COUNTDOWN, limit: ROUND_TIME, flash });
  r.timer = setTimeout(() => finishRound(r), COUNTDOWN + ROUND_TIME + SLACK);
}

// Time is measured on the client (word shown -> last key). The server waits for both reports (or the time limit).
function done(ws, m) {
  const r = ws.room, t = Number(m.time);
  if (r.state !== 'play' || m.round !== r.round || r.results[ws.slot] != null) return;
  if (!isFinite(t) || t < r.word.length * 30 || t > ROUND_TIME + SLACK) return; // implausible or over the limit -> ignore
  r.results[ws.slot] = t;
  const f = Number(m.first); // time to the first correct letter (client-side); under 80ms is not humanly possible -> ignore
  r.firsts[ws.slot] = isFinite(f) && f >= 80 && f <= t ? f : null;
  if (r.results[0] != null && r.results[1] != null) resolve(r);
}

// Client reports every wrong key. Used for Daiwa's clean win and Haru's instant flashbang.
function typo(ws, m) {
  const r = ws.room;
  if (r.state !== 'play' || m.round !== r.round || r.results[ws.slot] != null) return;
  r.typos[ws.slot]++;
  const opp = CHARS[r.players[1 - ws.slot].char];
  if (opp.typoFlash && Date.now() >= r.flashUntil[ws.slot]) { // no stacking while a flash is still on screen
    const ms = opp.flashMs || 500;
    r.flashUntil[ws.slot] = Date.now() + ms;
    send(ws, { type: 'flash', ms });
  }
}

function finishRound(r) {
  if (r.state !== 'play') return;
  if (r.results[0] == null && r.results[1] == null) { // nobody finished: no winner, new word
    r.state = 'result';
    bc(r, { type: 'draw' });
    setTimeout(() => nextRound(r), PAUSE);
  } else resolve(r);
}

function heal(p, slot, amount, ev) {
  const gained = Math.min(MAX_HP, p.hp + amount) - p.hp;
  if (gained > 0) { p.hp += gained; p.healAcc += gained; ev.push({ t: 'heal', slot, v: gained }); }
}

function resolve(r) {
  clearTimeout(r.timer); r.state = 'result';
  const [a, b] = r.results;
  const w = a == null ? 1 : b == null ? 0 : (a <= b ? 0 : 1);
  const att = r.players[w], def = r.players[1 - w], ca = CHARS[att.char], cd = CHARS[def.char];
  const loserTime = r.results[1 - w];
  const gap = loserTime == null ? null : (loserTime - r.results[w]) / 1000; // seconds between winner and loser (null = loser didn't finish)
  const ev = [], hit = [0, 0], actualDamage = [0, 0];
  let pierce = -1, counterHeal = 0;

  // ---- Attacker's damage ----
  let dmg = DMG + att.bonus;
  const lb = ca.lenBonus, extra = lb ? Math.max(0, r.word.length - lb.over) : 0; // Gold Ship: letters beyond 5
  if (extra > 0) { dmg += extra * lb.dmg; ev.push({ t: 'lenbonus', slot: w, v: extra * lb.dmg }); }
  if (ca.shieldDmg && att.shield > 0) { // TM Opera O: bonus damage from current shield
    const v = Math.floor(att.shield / ca.shieldDmg.div);
    if (v > 0) { dmg += v; ev.push({ t: 'shielddmg', slot: w, v }); }
  }
  if (ca.counter && def.healAcc > 0) { // Gentildonna: counter the enemy's accumulated healing
    const v = Math.min(ca.counter.cap, def.healAcc);
    dmg += v; counterHeal = v; def.healAcc = 0;
    ev.push({ t: 'counter', slot: w, v });
  }
  if (ca.cleanWin && r.typos[w] === 0) { dmg = Math.round(dmg * ca.cleanWin); ev.push({ t: 'clean', slot: w }); } // Daiwa: no typos
  if (ca.stacks) { // Special Week attacking
    if (att.stacks >= ca.stacks.max) { dmg *= 2; att.stacks = 0; ev.push({ t: 'stackx2', slot: w }); }
    else att.stacks = Math.min(ca.stacks.max, att.stacks + ca.stacks.onAttack);
  }
  const qd = ca.quickDraw; // Matikane: first correct letter typed under the limit AND she wins the round
  if (qd && r.firsts[w] != null && r.firsts[w] < qd.under) {
    dmg += qd.bonus;
    if (def.shield > 0) { dmg += qd.pierceBonus; pierce = 1 - w; }
    ev.push({ t: 'quick', slot: w });
  }

  // ---- Defender's mitigation ----
  let immune = false;
  if (cd.stacks) { // Special Week being hit
    if (def.stacks >= cd.stacks.max) { immune = true; def.stacks = cd.stacks.dropTo; ev.push({ t: 'immune', slot: 1 - w }); }
    else {
      dmg = Math.max(1, Math.round(dmg * (1 - def.stacks * cd.stacks.reduce)));
      def.stacks = Math.min(cd.stacks.max, def.stacks + cd.stacks.onHit);
    }
  }
  if (!immune) {
    if (cd.parry && gap != null && gap <= cd.parry.gap) { // Meisho: lost by <= gap -> she takes 50%, attacker takes 100%
      hit[1 - w] = Math.round(dmg / 2); hit[w] = dmg;
      ev.push({ t: 'reflect', slot: 1 - w });
    } else hit[1 - w] = dmg;
  }

  // ---- Apply damage, then per-player effects ----
  r.players.forEach((p, i) => {
    const c = CHARS[p.char];
    if (hit[i] > 0) {
      const absorbed = pierce === i ? 0 : Math.min(p.shield, hit[i]);
      p.shield -= absorbed;
      let toHp = hit[i] - absorbed;
      if (c.brokenCap) toHp = Math.min(toHp, c.brokenCap); // Oguri: anything reaching HP is capped
      actualDamage[i] = Math.min(p.hp, toHp);
      p.hp = Math.max(0, p.hp - toHp);
      p.noHit = 0;
    } else p.noHit++;
    if (p.hp <= 0 && c.revive && !p.revived) { p.hp = c.revive; p.revived = true; p.noHit = 0; ev.push({ t: 'revive', slot: i }); }
    if (p.hp <= 0) return;
    if (c.heal && p.noHit >= c.heal.after) { heal(p, i, c.heal.amount, ev); p.noHit = 0; }
    if (c.timeHeal && i === w) { // heal by time gap (min 1, max cap); loser didn't finish -> max
      const t = c.timeHeal;
      heal(p, i, gap == null ? t.max : Math.min(t.max, Math.max(1, Math.round(gap * t.mult))), ev);
    }
    if (counterHeal > 0 && i === w) heal(p, i, counterHeal, ev); // Gentildonna's matching heal
    if (c.winShield && i === w) { // TM Opera O: shield from missing HP
      const s = c.winShield, gain = Math.min(s.max, Math.round((MAX_HP - p.hp) * s.mult), s.cap - p.shield);
      if (gain > 0) { p.shield += gain; ev.push({ t: 'shield', slot: i, v: gain }); }
    }
    if (c.lenBonus && i === w && extra > 0) { // Gold Ship: shield from letters beyond 5
      const gain = Math.min(extra * c.lenBonus.shield, c.lenBonus.cap - p.shield);
      if (gain > 0) { p.shield += gain; ev.push({ t: 'shield', slot: i, v: gain }); }
    }
    if (c.ramp && r.round % c.ramp.every === 0) { p.bonus += c.ramp.amount; ev.push({ t: 'ramp', slot: i, v: c.ramp.amount }); }
  });

  bc(r, {
    type: 'result', winner: w, hit, actualDamage, ev,
    hp: r.players.map(p => p.hp), shield: r.players.map(p => p.shield), badge: r.players.map(badge), times: r.results
  });
  const d0 = r.players[0].hp <= 0, d1 = r.players[1].hp <= 0;
  if (d0 || d1) {
    const winner = d0 && d1 ? w : d0 ? 1 : 0; // both KO'd by a parry: the faster typer wins
    r.state = 'over';
    setTimeout(() => { bc(r, { type: 'over', winner }); rooms.delete(r.code); }, 2200);
  }
  else setTimeout(() => nextRound(r), PAUSE);
}

function leave(ws) {
  const r = ws.room; if (!r) return;
  clearTimeout(r.timer);
  if (rooms.get(r.code) === r) rooms.delete(r.code);
  r.players.forEach(p => { if (p.ws !== ws) send(p.ws, { type: 'left' }); });
}

server.listen(PORT, () => console.log('Typing Duel backend on :' + PORT));