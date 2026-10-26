const API = '/typing-duel/api';
const CARATS_IMG = '/typing-duel/assets/carats.png';
const $ = s => document.querySelector(s);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + '/ws';
const DAZE_MS = 1400; // how long the dizzy afterimage lasts after the white flash ends (visual only, server timing is unchanged)

const vv = window.visualViewport;
const fit = () => { document.documentElement.style.setProperty('--vh', (vv ? vv.height : innerHeight) + 'px'); scrollTo(0, 0); };
fit();
(vv || window).addEventListener('resize', fit);
if (vv) vv.addEventListener('scroll', fit);

let chars = [], sel, ws, slot, players;
let max = 100, word = '', typed = 0, startT = 0, firstT = null, limit = 10000, active = false, round = 0, typos = 0;
let stat = [{}, {}], shields = [0, 0];                // server-side status per player (for the skill dock)
let gameOver = false;                                 // once the victory / defeat screen is up, poison effects and auras are switched off
const pulses = [new Set(), new Set()];                // short-lived "just triggered" events per player

// ---------- Skill dock definitions (one entry per skill chip; each hero gets its own theme in CSS) ----------
// on(c) -> chip glows + character gets an aura. pips(c) -> [filled, total]. lv(c) -> [leaves filled, bursting] (Almond only)
// c = {st, opp, shield, round, ev, clean, fast}
const SK = {
    'daiwa-scarlet': [{ ic: '🔥', n: 'Berserker', v: '×1.5 tanpa typo', d: 'Menang tanpa salah ketik: damage x1,5', on: c => c.clean }],
    'special-week': [{ ic: '⭐', n: 'Come To Me', v: c => `${c.st.stacks || 0}/10 stack`, pips: c => [c.st.stacks || 0, 10], on: c => (c.st.stacks || 0) >= 10, d: 'Stack penuh: immune saat dipukul / damage x2 saat menyerang' }],
    'meisho-dotto': [{ ic: '♻️', n: 'Good Reflect',
        v: c => c.ev.has('perfect') ? 'PERFECT PARRY!' : c.ev.has('reflect') ? 'PARRY!' : `parry ≤${(c.st.parryGap ?? 0.3).toFixed(1)}s · perfect ≤0.3s`,
        on: c => c.ev.has('reflect') || c.ev.has('perfect'),
        d: 'Kalah tipis: damage -50% dipantulkan 100%. Selisih ≤0.3s = Perfect: pantulan x2 dan damage jadi heal. Window naik +0.1 (menang) / +0.2 (kalah), reset saat parry' }],
    'haru-urara': [{ ic: '⚡', n: 'Flashbang', v: '30% / typo lawan', d: 'Layar lawan di-flash', on: c => c.ev.has('flash') }],
    'almond-eye': [
        { n: 'Holy Seed',
          lv: c => [c.ev.has('seedburst') ? 2 : (c.st.seed || 0), c.ev.has('seedburst')],
          v: c => c.ev.has('seedburst') ? 'PECAH! +15 HP' : (c.st.seed ? 'guard: damage -2' : 'menang = +1 seed'),
          on: c => (c.st.seed || 0) > 0 || c.ev.has('seedburst'),
          d: 'Tiap menang +1 seed. Tiap seed kurangi damage 2. Di 2 seed: pecah, heal 15' },
        { ic: '👼', n: 'Revive', v: c => c.st.revived ? 'TERPAKAI' : 'SIAP', used: c => !!c.st.revived, aura: false, d: 'Hidup kembali sekali dengan 20 HP' }],
    'agnes-tachyon': [{ ic: '🧪', n: 'Got You', v: 'heal sesuai selisih', d: 'Heal tiap menang sesuai selisih waktu', on: c => c.ev.has('heal') }],
    'tokai-teio': [{ ic: '👑', n: 'Anger of Warrior', v: c => `guard ${c.st.red || 0}% · +${c.st.bonus || 0} DMG`, pips: c => [(c.st.red || 0) / 5, 10],
        on: c => (c.st.red || 0) > 0 || (c.st.bonus || 0) > 0, d: 'Mulai reduction 50%, tiap menyerang -5%. Di 0% tiap menyerang +1 damage permanen. Tiap 3 ronde +1 damage permanen' }],
    'satono-diamond': [{ ic: '☠️', n: 'Poison Mark',
        v: c => c.opp.poisonMax ? `Mark ${c.opp.poison || 0}/${c.opp.poisonMax} · Ledakan -${c.opp.poisonDmg}<br>+1 maks mark: ${(c.opp.poisonHits || 0) % c.opp.poisonGrow}/${c.opp.poisonGrow} ledakan` : 'menang = +2 mark',
        on: c => (c.opp.poison || 0) > 0,
        d: 'Menang: musuh dapat 2 mark (maks sesuai kapasitas). Ronde berikutnya mark meledak (true damage). Makin jauh selisih waktu, makin banyak mark meledak. Tiap 5 ledakan: maks mark +1 dan heal 10' }],
    'oguri-cap': [{ ic: '🪨', n: 'Harder Than Rock', v: c => c.shield > 0 ? `🛡 ${c.shield}` : 'cap 8 dmg', on: c => c.shield > 0, d: 'Shield awal 20; setelah hancur damage ke HP maks 8' }],
    'tm-opera-o': [{ ic: '🎭', n: "It's Not the End", v: c => `+${Math.floor(c.shield / 5)} DMG`, on: c => c.shield > 0, d: 'Menang = shield; tiap 5 shield +1 damage' }],
    'gold-ship': [{ ic: '⚓', n: 'More Than Your', v: 'kata >5 huruf', d: 'Huruf ekstra: +2 shield +1 damage', on: c => c.ev.has('lenbonus') }],
    'matikanefukukitaru': [{ ic: '🎯', n: 'Quick Draw', v: 'huruf 1 <0.6s', d: 'Huruf pertama sangat cepat: +3 damage, tembus shield', on: c => c.fast }],
    'gentildonna': [
        { ic: '🪞', n: 'Iron Mirror', v: c => c.st.mirror ? 'AKTIF: damage → heal' : `${c.round ? (c.round % 5 || 5) : 0}/5 ronde`,
          pips: c => c.st.mirror ? [5, 5] : [c.round ? (c.round % 5 || 5) : 0, 5], on: c => !!c.st.mirror, d: 'Ronde kelipatan 5 & lawan tidak heal: damage berikutnya jadi heal' },
        { ic: '💢', n: 'My Turn Now', v: c => c.opp.healAcc ? `counter +${Math.min(10, c.opp.healAcc)}` : 'tunggu heal lawan', on: c => (c.opp.healAcc || 0) > 0, d: 'Menang setelah lawan heal: damage + heal' }]
};

function renderFx(i) {
    if (!players) return;
    const id = players[i].char, c = {
        st: stat[i] || {}, opp: stat[1 - i] || {}, shield: shields[i] || 0, round, ev: pulses[i],
        clean: i === slot && active && typos === 0, fast: i === slot && firstT != null && firstT < 600
    };
    let aura = false;
    $(`#fx${i}`).innerHTML = (SK[id] || []).map(s => {
        const on = !!(s.on && s.on(c)), used = !!(s.used && s.used(c)), pips = s.pips && s.pips(c), lv = s.lv && s.lv(c);
        if (on && s.aura !== false) aura = true;
        const val = typeof s.v === 'function' ? s.v(c) : (s.v || '');
        const dots = pips ? `<p>${Array.from({ length: pips[1] }, (_, k) => `<s class="${k < pips[0] ? 'f' : ''}"></s>`).join('')}</p>` : '';
        // Almond: two leaves instead of the normal badge (silver = empty, green = seed, burst = both pop)
        const icon = lv
            ? `<em class="lv${lv[1] ? ' burst' : ''}"><i class="lf${lv[0] >= 1 ? ' g' : ''}"></i><i class="lf${lv[0] >= 2 ? ' g' : ''}"></i></em>`
            : `<em>${s.ic}</em>`;
        return `<div class="chip${on ? ' on' : ''}${used ? ' used' : ''}" title="${s.d || ''}">${icon}<div><b>${s.n}</b><small>${val}</small>${dots}</div></div>`;
    }).join('');
    $(`#c${i}`).classList.toggle('aura', aura && !gameOver);
    renderPz(i);
}

// Satono Diamond's poison marks as a plain container beside the poisoned character: one slot per max mark, one green fill per mark on them.
// (damage per explosion, max marks and progress are shown on Diamond's skill chip in the dock)
function renderPz(i) {
    const c = $(`#c${i}`), el = c && c.querySelector('.pz');
    if (!el) return;
    const s = stat[i] || {}, max = s.poisonMax || 0, n = s.poison || 0;
    el.hidden = !max || gameOver;
    c.classList.toggle('poisoned', n > 0 && !gameOver);
    if (!max || gameOver) return;
    el.className = 'pz' + (pulses[i].has('dot') ? ' boom' : '');
    el.innerHTML = `<div class="vial">${Array.from({ length: max }, (_, k) =>
        `<i class="seg${k < n ? ' f' : ''}${k === n - 1 && pulses[i].has('poisonMark') ? ' new' : ''}"></i>`).join('')}</div>`;
}

const pulse = (i, name, ms = 1500) => {
    pulses[i].add(name); renderFx(i);
    setTimeout(() => { pulses[i].delete(name); renderFx(i); }, ms);
};

const sprite = (id, st) => {
    const c = chars.find(c => c.id === id);
    if (!c) { console.error('Karakter tidak ada di characters.json:', id); return ''; }
    return `/typing-duel/characters/${id}/${c.sprites[st]}`;
};

fetch('/typing-duel/characters/characters.json').then(r => r.json()).then(list => {
    chars = list; sel = list[0].id;
    $('#chars').innerHTML = list.map(c =>
        `<div class="card h-${c.id}" data-id="${c.id}"><img src="/typing-duel/characters/${c.id}/${c.sprites.idle}">${c.name}</div>`).join('');
    $('#chars').onclick = e => { const k = e.target.closest('.card'); if (k) pick(k.dataset.id); };
    pick(sel);
});

function pick(id) {
    sel = id;
    document.querySelectorAll('.card').forEach(k => k.classList.toggle('sel', k.dataset.id === id));
    const c = chars.find(c => c.id === id);
    $('#desc').className = 'h-' + id;
    $('#desc').innerHTML = `<b>${c.name}</b>${c.desc}`;
}

let queued = false;
function connect(first) {
    $('#kb').focus();
    ws = new WebSocket(WS_URL);
    ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = e => handle(JSON.parse(e.data));
    ws.onclose = () => { if (!$('#game').hidden) return; lobbyIdle(); };
    ws.onerror = () => $('#msg').textContent = 'Tidak bisa terhubung ke server.';
}
function lobbyIdle() {
    queued = false;
    $('#go').disabled = false; $('#quick').disabled = false;
    document.querySelectorAll('.train').forEach(b => b.disabled = false);
    $('#quick').textContent = 'Cari lawan cepat';
}

document.querySelectorAll('.train').forEach(b => b.onclick = () => {
    $('#go').disabled = true; $('#quick').disabled = true;
    document.querySelectorAll('.train').forEach(x => x.disabled = true);
    $('#msg').style.color = '#ffffff'; $('#msg').textContent = 'Menyiapkan latihan...';
    connect({ type: 'training', name: $('#name').value, char: sel, level: b.dataset.level });
});

$('#go').onclick = () => {
    const room = $('#room').value.trim();
    if (!room) return $('#msg').textContent = 'Isi kode room dulu.';
    $('#go').disabled = true; $('#quick').disabled = true;
    connect({ type: 'join', room, name: $('#name').value, char: sel });
};

// Quick match: no room code needed, the server pairs the next two waiting players. Click again to cancel.
$('#quick').onclick = () => {
    if (queued) { ws.send(JSON.stringify({ type: 'cancel' })); ws.close(); $('#msg').textContent = ''; return lobbyIdle(); }
    $('#go').disabled = true; $('#quick').disabled = true;
    $('#msg').style.color = '#ffffff'; $('#msg').textContent = 'Menghubungkan...';
    connect({ type: 'quick', name: $('#name').value, char: sel });
};

function handle(m) {
    if (m.type === 'error') { $('#msg').style.color = ''; $('#msg').textContent = m.msg; lobbyIdle(); }
    else if (m.type === 'queued') {
        queued = true;
        $('#quick').disabled = false; $('#quick').textContent = 'Batal cari';
        $('#msg').style.color = '#ffffff'; $('#msg').textContent = 'Mencari lawan...';
    }
    else if (m.type === 'joined') {
        slot = m.slot;
        $('#msg').style.color = '#ffffff';
        $('#msg').textContent = `Room ${m.room}: menunggu lawan...`;
    } else if (m.type === 'start') {
        players = m.players; max = m.max; stat = m.st || [{}, {}]; shields = players.map(p => p.shield || 0);
        $('#lobby').hidden = true; $('#game').hidden = false;
        players.forEach((p, i) => {
            $(`#h${i} b`).textContent = p.name; setHp(i, p.hp, p.shield); setSprite(i, 'idle');
            $(`#fx${i}`).className = `fx${i ? ' r' : ''} h-${p.char}`;
            $(`#c${i}`).classList.add('h-' + p.char);
            if (!$(`#c${i} .pz`)) $(`#c${i}`).insertAdjacentHTML('beforeend', '<div class="pz" hidden></div>');
            renderFx(i);
        });
    }
    else if (m.type === 'round') startRound(m);
    else if (m.type === 'flash') flashScreen(m.ms);
    else if (m.type === 'draw') { active = false; $('#timer').classList.remove('on'); $('#info').textContent = 'Waktu habis! Tidak ada pemenang, ronde diulang.'; }
    else if (m.type === 'result') showResult(m);
    else if (m.type === 'over') over(m.winner);
    else if (m.type === 'left') over(null, 'Lawan keluar dari game.');
}

const setSprite = (i, st) => { $(`#c${i} img`).src = sprite(players[i].char, st); };

// HP fill + shield overlay (stacks / bonus / mirror / seeds live in the skill dock)
function setHp(i, hp, shield = 0) {
    const bar = $(`#h${i} .bar`);
    let sh = bar.querySelector('u');
    if (!sh) { sh = document.createElement('u'); bar.append(sh); }
    const hpPct = hp / max * 100, shPct = Math.min(shield, hp) / max * 100;
    $(`#h${i} i`).style.width = hpPct + '%';
    sh.style.width = shPct + '%';
    sh.style.left = (i ? 100 - hpPct : hpPct - shPct) + '%';
    sh.style.opacity = shPct > 0 ? 1 : 0;
    $(`#h${i}`).classList.toggle('low', hpPct < 30);
    $(`#h${i} span`).textContent = `${hp} / ${max}` + (shield > 0 ? `  🛡 ${shield}` : '');
}

// Haru's flashbang, CS2 style: instant white-out, then the veil fades while the word drifts around with double-vision ghosts.
let flashT1, flashT2;
function flashScreen(ms) {
    clearTimeout(flashT1); clearTimeout(flashT2);
    const f = $('#flash'), g = $('#game');
    f.classList.remove('fade'); g.classList.remove('dazed');
    void f.offsetWidth;                                   // restart the animation if a new flash lands mid-daze
    f.style.setProperty('--daze', DAZE_MS + 'ms');
    f.classList.add('on');
    flashT1 = setTimeout(() => { f.classList.remove('on'); f.classList.add('fade'); g.classList.add('dazed'); }, ms);
    flashT2 = setTimeout(() => { f.classList.remove('fade'); g.classList.remove('dazed'); }, ms + DAZE_MS);
}

function startRound(m) {
    round = m.round; word = m.word; typed = 0; firstT = null; typos = 0; active = false; limit = m.limit;
    $('#word').textContent = ''; $('#word').className = ''; $('#word').dataset.t = '';
    $('#rnd').textContent = `ROUND ${round}`;
    $('#timer').classList.remove('on'); $('#timer i').style.width = '100%';
    renderFx(0); renderFx(1);
    const t0 = performance.now();
    const tick = () => {
        const left = m.countdown - (performance.now() - t0);
        if (left <= 0) {
            renderWord();
            startT = performance.now(); active = true;
            if (m.flash[slot]) flashScreen(m.flash[slot]);
            [0, 1].forEach(i => { if (m.flash[1 - i]) pulse(i, 'flash', 1200); }); // Haru's chip lights up when her flash lands
            $('#timer').classList.add('on');
            renderFx(0); renderFx(1);
            runClock(round);
            return;
        }
        $('#info').textContent = `Ronde ${round} dimulai ${Math.ceil(left / 1000)}`;
        setTimeout(tick, 50);
    };
    tick();
}

// Typing time limit shown as a countdown + bar; input stops at 0.
function runClock(r) {
    const tick = () => {
        if (!active || r !== round) return;
        const left = limit - (performance.now() - startT);
        $('#timer i').style.width = Math.max(0, left / limit * 100) + '%';
        if (left <= 0) { active = false; $('#info').textContent = 'Waktu habis!'; renderFx(slot); return; }
        $('#info').textContent = `Sisa ${(left / 1000).toFixed(1)}s`;
        setTimeout(tick, 100);
    };
    tick();
}

function renderWord() {
    const w = $('#word');
    w.dataset.t = word; // used by the ghost copies while dazed
    w.innerHTML =
        `<span class="d">${word.slice(0, typed)}</span><span class="c">${word[typed] || ''}</span>` + word.slice(typed + 1);
}

const kb = $('#kb');

function typeChar(ch) {
    if (ch === word[typed]) {
        typed++; renderWord();
        if (typed === 1) { firstT = performance.now() - startT; renderFx(slot); }
        if (typed === word.length) {
            active = false;
            const time = performance.now() - startT;
            ws.send(JSON.stringify({ type: 'done', round, time, first: firstT }));
            $('#info').textContent = `Selesai ${(time / 1000).toFixed(2)}s, menunggu lawan...`;
            renderFx(slot);
        }
    } else {
        typos++; renderFx(slot);
        ws.send(JSON.stringify({ type: 'typo', round }));
        const w = $('#word'); w.classList.add('bad');
        setTimeout(() => w.classList.remove('bad'), 120);
    }
}

// Semua input (keyboard fisik maupun virtual) lewat event input
kb.addEventListener('input', () => {
    const v = kb.value.toLowerCase(); kb.value = '';
    if (!active) return;
    for (const ch of v) { if (!active) break; if (/\s/.test(ch)) continue; typeChar(ch); }
});

// Kalau fokus hilang (klik di tempat lain / ketuk layar), fokuskan lagi
$('#game').addEventListener('click', () => kb.focus());
document.addEventListener('keydown', () => { if (active && document.activeElement !== kb) kb.focus(); });

// Pop-ups are queued per side and shown one at a time, so heal / damage / skill texts never overlap.
const POP_MS = 750;                       // must match the .pop animation duration in style.css
const popQ = [[], []], popBusy = [false, false];
function pop(i, text, cls = '') {
    popQ[i].push([text, cls]);
    if (!popBusy[i]) nextPop(i);
}
function nextPop(i) {
    const n = popQ[i].shift();
    if (!n) { popBusy[i] = false; return; }
    popBusy[i] = true;
    const el = document.createElement('div');
    el.className = 'pop ' + n[1]; el.textContent = n[0];
    el.style[i ? 'right' : 'left'] = '10vw';
    $('#game').append(el);
    setTimeout(() => el.remove(), POP_MS);
    setTimeout(() => nextPop(i), POP_MS + 40);
}

// Throws the carats image from attacker to target.
const THROW_MS = 350;
function throwCarats(from, to) {
    const g = $('#game').getBoundingClientRect(), a = $(`#c${from}`).getBoundingClientRect(), b = $(`#c${to}`).getBoundingClientRect();
    const size = Math.max(40, Math.min(70, g.height * 0.07));
    const x0 = (from === 0 ? a.right : a.left - size) - g.left, y0 = a.top + a.height * 0.45 - size / 2 - g.top;
    const x1 = b.left + b.width / 2 - size / 2 - g.left, y1 = b.top + b.height * 0.45 - size / 2 - g.top;
    const el = document.createElement('img');
    el.src = CARATS_IMG; el.className = 'carats';
    el.style.width = el.style.height = size + 'px';
    $('#game').append(el);
    el.animate([
        { transform: `translate(${x0}px,${y0}px) rotate(0deg) scale(1)` },
        { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - size * 1.5}px) rotate(360deg) scale(1.25)`, offset: 0.5 },
        { transform: `translate(${x1}px,${y1}px) rotate(720deg) scale(1)` }
    ], { duration: THROW_MS, easing: 'ease-in', fill: 'forwards' }).onfinish = () => el.remove();
}

// Event label + color class: green = heal/seed, blue/gold = shield, cyan = mirror, purple = skill
const EV_TEXT = e => ({
    immune: 'IMMUNE!', reflect: 'PARRY!', heal: `HEAL +${e.v}`, ramp: `DMG +${e.v}`, shield: `SHIELD +${e.v}`,
    revive: 'REVIVE!', quick: 'QUICK DRAW!', lenbonus: `LEN +${e.v}`, shielddmg: `SHIELD DMG +${e.v}`,
    counter: `COUNTER +${e.v}`, clean: 'PERFECT x1.5!', stackx2: 'STACK x2!',
    mirror: `IRON MIRROR! +${e.v}`, mirrorOn: 'MIRROR READY!',
    seed: 'SEED +1', seedburst: 'SEED BURST!', seedguard: `SEED GUARD -${e.v}`, perfect: 'PERFECT PARRY! x2', redguard: `GUARD -${e.v}`,
    dot: e.n > 1 ? `POISON -${e.v} (${e.k}/${e.n})` : `POISON -${e.v}`,
    poisonMark: `MARK +${e.add}`, poisonCap: `MAX MARK ${e.v}`, poisonFull: 'MARK FULL'
}[e.t]);
const EV_CLASS = e => ['heal', 'revive', 'seed', 'seedburst'].includes(e.t) ? 'heal'
    : e.t === 'perfect' ? 'perfect'
    : e.t === 'dot' ? 'dot'
    : ['poisonMark', 'poisonCap', 'poisonFull'].includes(e.t) ? 'poison'
    : ['shield', 'seedguard', 'redguard'].includes(e.t) ? 'shield'
    : ['mirror', 'mirrorOn'].includes(e.t) ? 'mirror' : 'skill';

function showResult(m) {
    active = false;
    $('#timer').classList.remove('on');
    const w = m.winner, t = m.times.map(x => x == null ? '-' : (x / 1000).toFixed(2) + 's');
    $('#info').textContent = `${players[w].name} tercepat (${t[0]} vs ${t[1]})`;
    const A = $(`#c${w}`);
    setSprite(w, 'attacking'); A.classList.add('l' + w);
    const LAUNCH = 150, IMPACT = LAUNCH + THROW_MS;
    setTimeout(() => throwCarats(w, 1 - w), LAUNCH);

    setTimeout(() => {
        (m.actualDamage || m.hit || [0, 0]).forEach((d, i) => {
            if (d > 0) { setSprite(i, 'damaged'); $(`#c${i}`).classList.add('hit'); pop(i, `-${d}`, 'dmg'); }
        });
        m.ev.forEach(e => { if (e.t === 'dot') { setSprite(e.slot, 'damaged'); $(`#c${e.slot}`).classList.add('hit'); } });
        m.ev.forEach(e => { pop(e.slot, EV_TEXT(e), EV_CLASS(e)); pulses[e.slot].add(e.t); });
        m.shield.forEach((s, i) => {
            if ((players[i].shield || 0) > 0 && s === 0) pop(i, 'SHIELD BREAK!', 'shield');
            players[i].shield = s;
        });
        stat = m.st || stat; shields = m.shield;
        m.hp.forEach((h, i) => setHp(i, h, m.shield[i]));
        renderFx(0); renderFx(1);
        setTimeout(() => { pulses.forEach(s => s.clear()); renderFx(0); renderFx(1); }, 1500);
    }, IMPACT);

    setTimeout(() => {
        players.forEach((_, i) => setSprite(i, 'idle'));
        A.classList.remove('l' + w);
        document.querySelectorAll('.char').forEach(c => c.classList.remove('hit'));
    }, IMPACT + 1250);
}

function confetti() {
    const cols = ['#ff5fa8', '#3ec6ff', '#7bf1a8', '#ffd54a', '#fff'];
    for (let k = 0; k < 60; k++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        el.style.left = Math.random() * 100 + '%';
        el.style.background = cols[k % cols.length];
        el.style.animationDuration = 2 + Math.random() * 2.5 + 's';
        el.style.animationDelay = Math.random() * 1.2 + 's';
        $('#over').append(el);
    }
}

function over(winner, text) {
    gameOver = true;
    renderPz(0); renderPz(1);
    document.querySelectorAll('.char').forEach(c => c.classList.remove('aura', 'poisoned'));
    const win = winner === slot;
    $('#over h2').textContent = text || `${players[winner].name} menang!`;
    $('#verdict').textContent = winner == null ? '' : win ? 'VICTORY' : 'DEFEAT';
    $('#over').className = winner == null ? '' : win ? 'win' : 'lose';
    $('#over').hidden = false;
    $('#game').hidden = false;
    if (win) confetti();
}