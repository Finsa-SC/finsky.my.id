const API = '/typing-duel/api';
const CARATS_IMG = '/typing-duel/assets/carats.png';
const $ = s => document.querySelector(s);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + '/ws';

let chars = [], sel, ws, slot, players;
let max = 100, word = '', typed = 0, startT = 0, firstT = null, limit = 10000, active = false, round = 0;

const sprite = (id, st) => {
    const c = chars.find(c => c.id === id);
    if (!c) { console.error('Karakter tidak ada di characters.json:', id); return ''; }
    return `/typing-duel/characters/${id}/${c.sprites[st]}`;
};

fetch('/typing-duel/characters/characters.json').then(r => r.json()).then(list => {
    chars = list; sel = list[0].id;
    $('#chars').innerHTML = list.map(c =>
        `<div class="card" data-id="${c.id}"><img src="/typing-duel/characters/${c.id}/${c.sprites.idle}">${c.name}</div>`).join('');
    $('#chars').onclick = e => { const k = e.target.closest('.card'); if (k) pick(k.dataset.id); };
    pick(sel);
});

function pick(id) {
    sel = id;
    document.querySelectorAll('.card').forEach(k => k.classList.toggle('sel', k.dataset.id === id));
    $('#desc').textContent = chars.find(c => c.id === id).desc;
}

$('#go').onclick = () => {
    const room = $('#room').value.trim();
    if (!room) return $('#msg').textContent = 'Isi kode room dulu.';
    $('#go').disabled = true;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, name: $('#name').value, char: sel }));
    ws.onmessage = e => handle(JSON.parse(e.data));
    ws.onclose = () => { if (!$('#game').hidden) return; $('#go').disabled = false; };
    ws.onerror = () => $('#msg').textContent = 'Tidak bisa terhubung ke server.';
};

function handle(m) {
    if (m.type === 'error') { $('#msg').textContent = m.msg; $('#go').disabled = false; }
    else if (m.type === 'joined') {
        slot = m.slot;
        $('#msg').style.color = '#ffffff';
        $('#msg').textContent = `Room ${m.room}: menunggu lawan...`;
    } else if (m.type === 'start') {
        players = m.players; max = m.max;
        $('#lobby').hidden = true; $('#game').hidden = false;
        players.forEach((p, i) => { $(`#h${i} b`).textContent = p.name; setHp(i, p.hp, p.shield, m.badge[i]); setSprite(i, 'idle'); });
    }
    else if (m.type === 'round') startRound(m);
    else if (m.type === 'flash') flashScreen(m.ms);
    else if (m.type === 'draw') { active = false; $('#info').textContent = 'Waktu habis! Tidak ada pemenang, ronde diulang.'; }
    else if (m.type === 'result') showResult(m);
    else if (m.type === 'over') over(`${players[m.winner].name} menang!`);
    else if (m.type === 'left') over('Lawan keluar dari game.');
}

const setSprite = (i, st) => { $(`#c${i} img`).src = sprite(players[i].char, st); };

// HP fill + shield overlay + small badge (stacks / permanent bonus)
function setHp(i, hp, shield = 0, badge = '') {
    const bar = $(`#h${i} .bar`);
    let sh = bar.querySelector('u');
    if (!sh) { sh = document.createElement('u'); bar.append(sh); }
    const hpPct = hp / max * 100, shPct = Math.min(shield, hp) / max * 100;
    $(`#h${i} i`).style.width = hpPct + '%';
    sh.style.width = shPct + '%';
    sh.style.left = (i ? 100 - hpPct : hpPct - shPct) + '%';
    sh.style.opacity = shPct > 0 ? 1 : 0;
    $(`#h${i} span`).textContent = `${hp} / ${max}` + (shield > 0 ? `  🛡 ${shield}` : '') + (badge ? `  ${badge}` : '');
}

function flashScreen(ms) {
    $('#flash').classList.add('on');
    setTimeout(() => $('#flash').classList.remove('on'), ms);
}

function startRound(m) {
    round = m.round; word = m.word; typed = 0; firstT = null; active = false; limit = m.limit;
    $('#word').textContent = ''; $('#word').className = '';
    const t0 = performance.now();
    const tick = () => {
        const left = m.countdown - (performance.now() - t0);
        if (left <= 0) {
            renderWord();
            startT = performance.now(); active = true;
            if (m.flash[slot]) flashScreen(m.flash[slot]);
            runClock(round);
            return;
        }
        $('#info').textContent = `Ronde ${round} dimulai ${Math.ceil(left / 1000)}`;
        setTimeout(tick, 50);
    };
    tick();
}

// Typing time limit shown as a countdown; input stops at 0.
function runClock(r) {
    const tick = () => {
        if (!active || r !== round) return;
        const left = limit - (performance.now() - startT);
        if (left <= 0) { active = false; $('#info').textContent = 'Waktu habis!'; return; }
        $('#info').textContent = `Sisa ${(left / 1000).toFixed(1)}s`;
        setTimeout(tick, 100);
    };
    tick();
}

function renderWord() {
    $('#word').innerHTML =
        `<span class="d">${word.slice(0, typed)}</span><span class="c">${word[typed] || ''}</span>` + word.slice(typed + 1);
}

document.addEventListener('keydown', e => {
    if (!active || e.ctrlKey || e.metaKey || e.key.length !== 1) return;
    e.preventDefault();
    if (e.key.toLowerCase() === word[typed]) {
        typed++; renderWord();
        if (typed === 1) firstT = performance.now() - startT; // time to the first correct letter (Quick Draw)
        if (typed === word.length) {
            active = false;
            const time = performance.now() - startT; // client-side timing
            ws.send(JSON.stringify({ type: 'done', round, time, first: firstT }));
            $('#info').textContent = `Selesai ${(time / 1000).toFixed(2)}s, menunggu lawan...`;
        }
    } else {
        ws.send(JSON.stringify({ type: 'typo', round }));
        const w = $('#word'); w.classList.add('bad');
        setTimeout(() => w.classList.remove('bad'), 120);
    }
});

function pop(i, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'pop ' + cls; el.textContent = text;
    el.style[i ? 'right' : 'left'] = '10vw';
    $('#game').append(el);
    setTimeout(() => el.remove(), 1200);
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

// Event label + color class: green = heal, blue = shield, purple = skill
const EV_TEXT = e => ({
    immune: 'IMMUNE!', reflect: 'PARRY!', heal: `HEAL +${e.v}`, ramp: `DMG +${e.v}`, shield: `SHIELD +${e.v}`,
    revive: 'REVIVE!', quick: 'QUICK DRAW!', lenbonus: `LEN +${e.v}`, shielddmg: `SHIELD DMG +${e.v}`,
    counter: `COUNTER +${e.v}`, clean: 'PERFECT x1.5!', stackx2: 'STACK x2!'
}[e.t]);
const EV_CLASS = e => ['heal', 'revive'].includes(e.t) ? 'heal' : e.t === 'shield' ? 'shield' : 'skill';

function showResult(m) {
    active = false;
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
        m.ev.forEach(e => pop(e.slot, EV_TEXT(e), EV_CLASS(e)));
        m.shield.forEach((s, i) => {
            if ((players[i].shield || 0) > 0 && s === 0) pop(i, 'SHIELD BREAK!', 'shield');
            players[i].shield = s;
        });
        m.hp.forEach((h, i) => setHp(i, h, m.shield[i], m.badge[i]));
    }, IMPACT);

    setTimeout(() => {
        players.forEach((_, i) => setSprite(i, 'idle'));
        A.classList.remove('l' + w);
        document.querySelectorAll('.char').forEach(c => c.classList.remove('hit'));
    }, IMPACT + 1250);
}

function over(text) {
    $('#over h2').textContent = text;
    $('#over').hidden = false;
    $('#game').hidden = false;
}