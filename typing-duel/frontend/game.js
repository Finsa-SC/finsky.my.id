const API = '/typing-duel/api';
const $ = s => document.querySelector(s);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + API + '/ws';
let chars = [], sel, ws, slot, players, max = 100, word = '', typed = 0, startT = 0, active = false, round = 0;
const sprite = (id, st) => {
    const c = chars.find(c => c.id === id);
    if (!c) { console.error('Karakter tidak ada di characters.json:', id); return ''; }
    return `/typing-duel/characters/${id}/${c.sprites[st]}`;
};

fetch('/typing-duel/characters/characters.json').then(r => r.json()).then(list => {
    chars = list; sel = list[0].id;
    $('#chars').innerHTML = list.map(c => `<div class="card" data-id="${c.id}"><img src="/typing-duel/characters/${c.id}/${c.sprites.idle}">${c.name}</div>`).join('');
    $('#chars').onclick = e => { const k = e.target.closest('.card'); if (k) pick(k.dataset.id); };
    pick(sel);
});
function pick(id) {
    sel = id; document.querySelectorAll('.card').forEach(k => k.classList.toggle('sel', k.dataset.id === id));
    $('#desc').textContent = chars.find(c => c.id === id).desc;
}
$('#go').onclick = () => {
    const room = $('#room').value.trim(); if (!room) return $('#msg').textContent = 'Isi kode room dulu.';
    $('#go').disabled = true; ws = new WebSocket(WS_URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, name: $('#name').value, char: sel }));
    ws.onmessage = e => handle(JSON.parse(e.data));
    ws.onclose = () => { if (!$('#game').hidden) return; $('#go').disabled = false; };
    ws.onerror = () => $('#msg').textContent = 'Tidak bisa terhubung ke server.';
};

function handle(m) {
    if (m.type === 'error') { $('#msg').textContent = m.msg; $('#go').disabled = false; }
    else if (m.type === 'joined') { slot = m.slot; $('#msg').style.color = '#ffffff'; $('#msg').textContent = `Room ${m.room}: menunggu lawan...`; }
    else if (m.type === 'start') {
        players = m.players; max = m.max; $('#lobby').hidden = true; $('#game').hidden = false;
        players.forEach((p, i) => { $(`#h${i} b`).textContent = p.name; setHp(i, p.hp); setSprite(i, 'idle'); });
    }
    else if (m.type === 'round') startRound(m);
    else if (m.type === 'result') showResult(m);
    else if (m.type === 'over') over(`${players[m.winner].name} menang!`);
    else if (m.type === 'left') over('Lawan keluar dari game.');
}
const setSprite = (i, st) => $(`#c${i} img`).src = sprite(players[i].char, st);
function setHp(i, hp) { $(`#h${i} i`).style.width = hp / max * 100 + '%'; $(`#h${i} span`).textContent = `${hp} / ${max}`; }

function startRound(m) {
    round = m.round; word = m.word; typed = 0; active = false; $('#word').textContent = ''; $('#word').className = '';
    const t0 = performance.now();
    const tick = () => {
        const left = m.countdown - (performance.now() - t0);
        if (left <= 0) {
            renderWord(); startT = performance.now(); active = true; $('#info').textContent = 'Ketik!';
            if (m.flash[slot]) { $('#flash').classList.add('on'); setTimeout(() => $('#flash').classList.remove('on'), 1000); }
            return;
        }
        $('#info').textContent = `Ronde ${round} dimulai ${Math.ceil(left / 1000)}`; setTimeout(tick, 50);
    };
    tick();
}
function renderWord() {
    $('#word').innerHTML = `<span class="d">${word.slice(0, typed)}</span><span class="c">${word[typed] || ''}</span>${word.slice(typed + 1)}`;
}
document.addEventListener('keydown', e => {
    if (!active || e.ctrlKey || e.metaKey || e.key.length !== 1) return;
    e.preventDefault();
    if (e.key.toLowerCase() === word[typed]) {
        typed++; renderWord();
        if (typed === word.length) { // client-side timing, sent once
            active = false; const time = performance.now() - startT;
            ws.send(JSON.stringify({ type: 'done', round, time })); $('#info').textContent = `Selesai ${(time / 1000).toFixed(2)}s, menunggu hasil...`;
        }
    } else { const w = $('#word'); w.classList.add('bad'); setTimeout(() => w.classList.remove('bad'), 120); }
});

function pop(i, text) {
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = text;
    el.style[i ? 'right' : 'left'] = '10vw'; $('#game').append(el); setTimeout(() => el.remove(), 1200);
}
function showResult(m) {
    active = false; const w = m.winner, t = m.times.map(x => x == null ? '-' : (x / 1000).toFixed(2) + 's');
    $('#info').textContent = `${players[w].name} tercepat (${t[0]} vs ${t[1]})`;
    const A = $(`#c${w}`);
    setSprite(w, 'attacking'); A.classList.add('l' + w);
    setTimeout(() => {
        m.hit.forEach((d, i) => {
            if (d > 0) { setSprite(i, 'damaged'); $(`#c${i}`).classList.add('hit'); pop(i, `-${d}`); }
        });
        m.ev.forEach(e => pop(e.slot, { crit: 'CRIT x2!', immune: 'IMMUNE!', reflect: 'SPLIT 50%!', heal: `HEAL +${e.v}` }[e.t]));
        m.hp.forEach((h, i) => setHp(i, h));
    }, 250);
    setTimeout(() => {
        players.forEach((_, i) => setSprite(i, 'idle'));
        A.classList.remove('l' + w);
        document.querySelectorAll('.char').forEach(c => c.classList.remove('hit'));
    }, 1500);
}
function over(text) { $('#over h2').textContent = text; $('#over').hidden = false; $('#game').hidden = false; }