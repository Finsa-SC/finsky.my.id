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
// Raw per-player status sent to the client so the skill dock can show stacks / seeds / mirror / etc.
// Satono Diamond's poison: capacity grows with the poison hits the victim has taken, damage grows with the round number.
const poisonMax = (v, pc) => pc ? pc.max + Math.floor(v.poisonHits / pc.growEvery) : 0;
const poisonDmg = (pc, round) => pc ? pc.base + pc.roundBonus * Math.floor(round / pc.roundEvery) : 0;
// opp = the other player (needed for the poison info), round = the round whose resolve comes next.
const status = (p, opp, round) => {
  const pc = CHARS[opp.char].poison;
  return { stacks: p.stacks, bonus: p.bonus, red: p.red, mirror: p.mirror, seed: p.seed, parryGap: p.parryGap, revived: p.revived, noHit: p.noHit, healAcc: p.healAcc,
    poison: p.poison, poisonMax: poisonMax(p, pc), poisonDmg: poisonDmg(pc, round), poisonHits: p.poisonHits, poisonGrow: pc ? pc.growEvery : 0 };
};
const stats = r => r.players.map((p, i) => status(p, r.players[1 - i], r.round + 1));

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
    if (m.type === 'join' && !ws.room && !ws.queued) join(ws, m);
    else if (m.type === 'quick' && !ws.room && !ws.queued) quick(ws, m);
    else if (m.type === 'training' && !ws.room && !ws.queued) training(ws, m);
    else if (m.type === 'cancel' && ws.queued) unqueue(ws);
    else if (m.type === 'done' && ws.room) done(ws, m);
    else if (m.type === 'typo' && ws.room) typo_(ws, m);
  });
  ws.on('close', () => leave(ws));
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);

// ---- Training mode: lawan bot. Bot = "socket" palsu yang tidak mengirim apa-apa, lalu `done` dijadwalkan sesuai kecepatan ketik orang biasa ----
const rand = (a, b) => a + Math.random() * (b - a);
// Level bot. WPM ≈ cps × 12. Normal ±40-70 WPM, Hard ±90-110 WPM (setara typist yang jago, bukan monster).
const BOTS = {
  normal: { react: [350, 650], cps: [3.5, 6],   typoChance: 0.25, typoCost: 350 },
  hard:   { react: [250, 420], cps: [7.5, 9.5], typoChance: 0.10, typoCost: 300 }
};
function training(ws, m) {
  if (!CHARS[m.char]) return send(ws, { type: 'error', msg: 'Karakter tidak dikenal server.' });
  const ids = Object.keys(CHARS);
  const botChar = ids[Math.floor(Math.random() * ids.length)];      // selalu acak
  const level = m.level === 'hard' ? 'hard' : 'normal';
  const botWs = { readyState: 1, send() {}, isBot: true, level };
  let code; do { code = 'T' + Math.random().toString(36).slice(2, 9).toUpperCase(); } while (rooms.has(code));
  join(ws, { room: code, name: m.name, char: m.char });
  join(botWs, { room: code, name: level === 'hard' ? 'Bot (Hard)' : 'Bot', char: botChar });
}

function botPlay(r, slot, flashMs) {
  const p = r.players[slot], round = r.round, B = BOTS[p.ws.level] || BOTS.normal;
  const react = rand(...B.react);
  const perChar = 1000 / rand(...B.cps);
  let time = react + r.word.length * perChar + flashMs;      // kena flashbang = lebih lambat
  const typo = chance(B.typoChance);
  if (typo) time += B.typoCost;
  const first = react + flashMs + 100;
  setTimeout(() => {
    if (typo) typo_(p.ws, { round });
    done(p.ws, { round, time, first });
  }, COUNTDOWN + Math.min(time, ROUND_TIME + SLACK));
}

// ---- Quick match: players wait in a FIFO queue; as soon as two are waiting they get a private auto-generated room ----
const queue = [];
const unqueue = ws => { const k = queue.findIndex(q => q.ws === ws); if (k >= 0) queue.splice(k, 1); ws.queued = false; };
function quick(ws, m) {
  if (!CHARS[m.char]) return send(ws, { type: 'error', msg: 'Karakter tidak dikenal server.' });
  while (queue.length && queue[0].ws.readyState !== 1) queue.shift(); // drop players who disconnected while waiting
  if (!queue.length) { queue.push({ ws, name: m.name, char: m.char }); ws.queued = true; return send(ws, { type: 'queued' }); }
  const other = queue.shift(); other.ws.queued = false;
  let code; do { code = 'Q' + Math.random().toString(36).slice(2, 9).toUpperCase(); } while (rooms.has(code));
  join(other.ws, { room: code, name: other.name, char: other.char });
  join(ws, { room: code, name: m.name, char: m.char });
}

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
  // mirror = Gentildonna's Iron Mirror is active, healed = this player healed during the current 5-round window, seed = Almond's Holy Seed count, red = Teio's damage reduction %, poison/poisonHits = marks on this player / poison hits taken (Satono Diamond), parryGap = Meisho's current parry window (seconds)
  r.players.push({ ws, name, char, hp: MAX_HP, noHit: 0, bonus: 0, stacks: 0, seed: 0, red: (CHARS[char].reduction || {}).start || 0, poison: 0, poisonHits: 0, parryGap: (CHARS[char].parry || {}).gap || 0, healAcc: 0, revived: false, mirror: false, healed: false, shield: CHARS[char].shield || 0 });
  ws.room = r; ws.slot = r.players.length - 1;
  send(ws, { type: 'joined', slot: ws.slot, room: code });
  if (r.players.length === 2) {
    bc(r, { type: 'start', max: MAX_HP, players: r.players.map(p => ({ name: p.name, char: p.char, hp: p.hp, shield: p.shield })), badge: r.players.map(badge), st: stats(r) });
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
  r.players.forEach((p, i) => { if (p.ws.isBot) botPlay(r, i, flash[i]); });
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
function typo_(ws, m) {
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
  if (gained > 0) { p.hp += gained; p.healAcc += gained; p.healed = true; ev.push({ t: 'heal', slot, v: gained }); }
}

// Satono Diamond: marks on player i explode. TRUE damage straight off HP: ignores shield, reductions, caps and Iron Mirror, and never counts as "being hit".
// Explosions = 1 (guaranteed) + 1 per gapStep seconds Diamond won the round by (loser didn't finish -> every mark), limited by the marks present.
// Every explosion is its own event so the client can show them one after another.
function poisonTick(r, i, ev, gap, w) {
  const v = r.players[i], dia = r.players[1 - i], pc = CHARS[dia.char].poison;
  if (!pc || v.poison <= 0 || v.hp <= 0) return;
  const each = poisonDmg(pc, r.round), oldMax = poisonMax(v, pc);
  let n = 1;
  if (w === 1 - i) n = gap == null ? v.poison : 1 + Math.floor(gap / pc.gapStep);
  n = Math.min(n, v.poison);
  for (let k = 1; k <= n; k++) ev.push({ t: 'dot', slot: i, v: each, k, n });
  v.poison -= n; v.poisonHits += n;
  v.hp = Math.max(0, v.hp - n * each);
  const newMax = poisonMax(v, pc);
  if (newMax > oldMax) { // every growEvery poison hits: +1 capacity and the Diamond heals
    ev.push({ t: 'poisonCap', slot: i, v: newMax });
    if (dia.hp > 0 && pc.capHeal) heal(dia, 1 - i, pc.capHeal * (newMax - oldMax), ev);
  }
}

function resolve(r) {
  clearTimeout(r.timer); r.state = 'result';
  const [a, b] = r.results;
  const w = a == null ? 1 : b == null ? 0 : (a <= b ? 0 : 1);
  const att = r.players[w], def = r.players[1 - w], ca = CHARS[att.char], cd = CHARS[def.char];
  const loserTime = r.results[1 - w];
  const gap = loserTime == null ? null : (loserTime - r.results[w]) / 1000; // seconds between winner and loser (null = loser didn't finish)
  const ev = [], hit = [0, 0], actualDamage = [0, 0];
  let pierce = -1, counterHeal = 0, parried = -1, perfectHeal = 0; // parried = slot of the Meisho who parried this round

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
    const pr = cd.parry;
    if (pr && gap != null && gap <= def.parryGap) { // Meisho: lost by <= her current window -> parry
      parried = 1 - w;
      if (gap <= pr.perfect.gap) { // PERFECT parry: attacker takes x2, her damage becomes healing
        hit[w] = Math.round(dmg * pr.perfect.reflect);
        perfectHeal = Math.round(dmg * pr.perfect.healFrac);
        ev.push({ t: 'perfect', slot: 1 - w, v: hit[w] });
      } else { // normal parry: she takes 50%, attacker takes 100%
        hit[1 - w] = Math.round(dmg / 2); hit[w] = dmg;
        ev.push({ t: 'reflect', slot: 1 - w });
      }
    } else hit[1 - w] = dmg;
  }

  // ---- Apply damage, then per-player effects ----
  r.players.forEach((p, i) => {
    const c = CHARS[p.char];
    if (c.parry) { // Meisho's window: reset on parry, otherwise grows (+growAtk on a win, +growHit on a loss)
      const pr = c.parry;
      p.parryGap = parried === i ? pr.gap : Math.round((p.parryGap + (i === w ? pr.growAtk : pr.growHit)) * 10) / 10;
    }
    if (hit[i] > 0 && c.seed && p.seed > 0) { // Almond Eye: each seed cuts the incoming hit (never below 1)
      const red = Math.min(hit[i] - 1, p.seed * c.seed.reduce);
      if (red > 0) { hit[i] -= red; ev.push({ t: 'seedguard', slot: i, v: red }); }
    }
    if (hit[i] > 0 && c.reduction && p.red > 0) { // Tokai Teio: % damage reduction on incoming hits (never below 1)
      const cut = hit[i] - Math.max(1, Math.round(hit[i] * (1 - p.red / 100)));
      if (cut > 0) { hit[i] -= cut; ev.push({ t: 'redguard', slot: i, v: cut }); }
    }
    if (hit[i] > 0 && c.ironMirror && p.mirror) { // Iron Mirror: incoming damage -> heal, effect consumed (shield untouched)
      const v = hit[i]; p.mirror = false; hit[i] = 0; p.noHit = 0;
      ev.push({ t: 'mirror', slot: i, v }); heal(p, i, v, ev);
    } else if (hit[i] > 0) {
      const absorbed = pierce === i ? 0 : Math.min(p.shield, hit[i]);
      p.shield -= absorbed;
      let toHp = hit[i] - absorbed;
      if (c.brokenCap) toHp = Math.min(toHp, c.brokenCap); // Oguri: anything reaching HP is capped
      actualDamage[i] = Math.min(p.hp, toHp);
      p.hp = Math.max(0, p.hp - toHp);
      p.noHit = 0;
    } else p.noHit++;
    poisonTick(r, i, ev, gap, w); // Satono Diamond's marks (true damage, separate from normal hits)
    if (p.hp <= 0 && c.revive && !p.revived) { p.hp = c.revive; p.revived = true; p.noHit = 0; ev.push({ t: 'revive', slot: i }); }
    if (p.hp <= 0) return;
    if (perfectHeal > 0 && i === parried) heal(p, i, perfectHeal, ev); // Meisho perfect parry: would-be damage -> heal
    if (c.heal && p.noHit >= c.heal.after) { heal(p, i, c.heal.amount, ev); p.noHit = 0; }
    if (c.seed && i === w) { // Almond Eye: +1 seed per win; reaching the burst count -> seeds burst and heal
      p.seed++;
      if (p.seed >= c.seed.burst) {
        p.seed = 0;
        ev.push({ t: 'seedburst', slot: i, v: c.seed.heal });
        heal(p, i, c.seed.heal, ev);
      } else ev.push({ t: 'seed', slot: i, v: p.seed });
    }
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
    if (c.reduction && i === w) { // Tokai Teio: each attack strips `step`% of her reduction; at 0% each attack gives permanent +bonus damage
      if (p.red > 0) p.red = Math.max(0, p.red - c.reduction.step);
      else { p.bonus += c.reduction.bonus; ev.push({ t: 'ramp', slot: i, v: c.reduction.bonus }); }
    }
    if (c.ramp && r.round % c.ramp.every === 0) { p.bonus += c.ramp.amount; ev.push({ t: 'ramp', slot: i, v: c.ramp.amount }); }
  });

  // ---- Satono Diamond: winning puts a poison mark on the enemy (it can only explode from the next round on) ----
  if (ca.poison && def.hp > 0) {
    const add = Math.min(ca.poison.perWin, poisonMax(def, ca.poison) - def.poison); // capped by the enemy's mark capacity
    if (add > 0) { def.poison += add; ev.push({ t: 'poisonMark', slot: 1 - w, v: def.poison, add }); }
    else ev.push({ t: 'poisonFull', slot: 1 - w });
  }

  // ---- Iron Mirror check: every Nth round, if the enemy did not heal during the window -> activate ----
  r.players.forEach((p, i) => {
    const c = CHARS[p.char];
    if (c.ironMirror && r.round % c.ironMirror.every === 0 && p.hp > 0 && !p.mirror && !r.players[1 - i].healed) {
      p.mirror = true; ev.push({ t: 'mirrorOn', slot: i });
    }
  });
  if (r.round % 5 === 0) r.players.forEach(p => p.healed = false); // new 5-round window

  bc(r, {
    type: 'result', winner: w, hit, actualDamage, ev,
    hp: r.players.map(p => p.hp), shield: r.players.map(p => p.shield), badge: r.players.map(badge), st: stats(r), times: r.results
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
  unqueue(ws);
  const r = ws.room; if (!r) return;
  clearTimeout(r.timer);
  if (rooms.get(r.code) === r) rooms.delete(r.code);
  r.players.forEach(p => { if (p.ws !== ws) send(p.ws, { type: 'left' }); });
}

server.listen(PORT, () => console.log('Typing Duel backend on :' + PORT));