const API = '/typing-duel/api';
const CARATS_IMG = '/typing-duel/assets/carats.png';
const $ = s => document.querySelector(s);

const WS_URL =
    (location.protocol === 'https:' ? 'wss://' : 'ws://')
    + location.host
    + API
    + '/ws';

let chars = [];
let sel, ws, slot, players;
let max = 100;
let word = '';
let typed = 0;
let startT = 0;
let active = false;
let round = 0;

const sprite = (id, st) => {
    const c = chars.find(c => c.id === id);

    if (!c) {
        console.error(
            'Karakter tidak ada di characters.json:',
            id
        );

        return '';
    }

    return `/typing-duel/characters/${id}/${c.sprites[st]}`;
};

fetch('/typing-duel/characters/characters.json')
    .then(r => r.json())
    .then(list => {
        chars = list;
        sel = list[0].id;

        $('#chars').innerHTML = list.map(c =>
            `<div class="card" data-id="${c.id}">
                <img src="/typing-duel/characters/${c.id}/${c.sprites.idle}">
                ${c.name}
            </div>`
        ).join('');

        $('#chars').onclick = e => {
            const k = e.target.closest('.card');

            if (k) pick(k.dataset.id);
        };

        pick(sel);
    });

function pick(id) {
    sel = id;

    document.querySelectorAll('.card').forEach(k => {
        k.classList.toggle('sel', k.dataset.id === id);
    });

    $('#desc').textContent =
        chars.find(c => c.id === id).desc;
}

$('#go').onclick = () => {
    const room = $('#room').value.trim();

    if (!room) {
        return $('#msg').textContent = 'Isi kode room dulu.';
    }

    $('#go').disabled = true;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'join',
            room,
            name: $('#name').value,
            char: sel
        }));
    };

    ws.onmessage = e => handle(JSON.parse(e.data));

    ws.onclose = () => {
        if (!$('#game').hidden) return;

        $('#go').disabled = false;
    };

    ws.onerror = () => {
        $('#msg').textContent =
            'Tidak bisa terhubung ke server.';
    };
};

function handle(m) {
    if (m.type === 'error') {
        $('#msg').textContent = m.msg;
        $('#go').disabled = false;
    } else if (m.type === 'joined') {
        slot = m.slot;

        $('#msg').style.color = '#ffffff';
        $('#msg').textContent =
            `Room ${m.room}: menunggu lawan...`;
    } else if (m.type === 'start') {
        players = m.players;
        max = m.max;

        $('#lobby').hidden = true;
        $('#game').hidden = false;

        players.forEach((p, i) => {
            $(`#h${i} b`).textContent = p.name;
            setHp(i, p.hp, p.shield);
            setSprite(i, 'idle');
        });
    } else if (m.type === 'round') {
        startRound(m);
    } else if (m.type === 'result') {
        showResult(m);
    } else if (m.type === 'over') {
        over(`${players[m.winner].name} menang!`);
    } else if (m.type === 'left') {
        over('Lawan keluar dari game.');
    }
}

const setSprite = (i, st) => {
    $(`#c${i} img`).src = sprite(players[i].char, st);
};

// HP fill + shield overlay.
function setHp(i, hp, shield = 0) {
    const bar = $(`#h${i} .bar`);

    let sh = bar.querySelector('u');

    if (!sh) {
        sh = document.createElement('u');
        bar.append(sh);
    }

    const hpPct = hp / max * 100;
    const shPct = Math.min(shield, hp) / max * 100;

    $(`#h${i} i`).style.width = hpPct + '%';

    sh.style.width = shPct + '%';

    sh.style.left = (
        i
            ? 100 - hpPct
            : hpPct - shPct
    ) + '%';

    sh.style.opacity = shPct > 0 ? 1 : 0;

    $(`#h${i} span`).textContent =
        `${hp} / ${max}`
        + (shield > 0 ? `  🛡 ${shield}` : '');
}

function startRound(m) {
    round = m.round;
    word = m.word;
    typed = 0;
    active = false;

    $('#word').textContent = '';
    $('#word').className = '';

    const t0 = performance.now();

    const tick = () => {
        const left =
            m.countdown - (performance.now() - t0);

        if (left <= 0) {
            renderWord();

            startT = performance.now();
            active = true;

            $('#info').textContent = 'Ketik!';

            if (m.flash[slot]) {
                $('#flash').classList.add('on');

                setTimeout(
                    () => $('#flash').classList.remove('on'),
                    m.flash[slot]
                );
            }

            return;
        }

        $('#info').textContent =
            `Ronde ${round} dimulai ${Math.ceil(left / 1000)}`;

        setTimeout(tick, 50);
    };

    tick();
}

function renderWord() {
    $('#word').innerHTML =
        `<span class="d">${word.slice(0, typed)}</span>`
        + `<span class="c">${word[typed] || ''}</span>`
        + word.slice(typed + 1);
}

document.addEventListener('keydown', e => {
    if (
        !active ||
        e.ctrlKey ||
        e.metaKey ||
        e.key.length !== 1
    ) return;

    e.preventDefault();

    if (e.key.toLowerCase() === word[typed]) {
        typed++;
        renderWord();

        if (typed === word.length) {
            active = false;

            const time = performance.now() - startT;

            ws.send(JSON.stringify({
                type: 'done',
                round,
                time
            }));

            $('#info').textContent =
                `Selesai ${(time / 1000).toFixed(2)}s, menunggu hasil...`;
        }
    } else {
        const w = $('#word');

        w.classList.add('bad');

        setTimeout(
            () => w.classList.remove('bad'),
            120
        );
    }
});

function pop(i, text, cls = '') {
    const el = document.createElement('div');

    el.className = 'pop ' + cls;
    el.textContent = text;
    el.style[i ? 'right' : 'left'] = '10vw';

    $('#game').append(el);

    setTimeout(() => el.remove(), 1200);
}

// Throws the carats image from attacker to target.
const THROW_MS = 350;

function throwCarats(from, to) {
    const g = $('#game').getBoundingClientRect();
    const a = $(`#c${from}`).getBoundingClientRect();
    const b = $(`#c${to}`).getBoundingClientRect();

    const size = Math.max(
        40,
        Math.min(70, g.height * 0.07)
    );

    const x0 = (
        from === 0
            ? a.right
            : a.left - size
    ) - g.left;

    const y0 =
        a.top + a.height * 0.45
        - size / 2
        - g.top;

    const x1 =
        b.left + b.width / 2
        - size / 2
        - g.left;

    const y1 =
        b.top + b.height * 0.45
        - size / 2
        - g.top;

    const el = document.createElement('img');

    el.src = CARATS_IMG;
    el.className = 'carats';
    el.style.width = el.style.height = size + 'px';

    $('#game').append(el);

    el.animate([
        {
            transform:
                `translate(${x0}px,${y0}px) rotate(0deg) scale(1)`
        },
        {
            transform:
                `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - size * 1.5}px) rotate(360deg) scale(1.25)`,
            offset: 0.5
        },
        {
            transform:
                `translate(${x1}px,${y1}px) rotate(720deg) scale(1)`
        }
    ], {
        duration: THROW_MS,
        easing: 'ease-in',
        fill: 'forwards'
    }).onfinish = () => el.remove();
}

function showResult(m) {
    active = false;

    const w = m.winner;

    const t = m.times.map(x =>
        x == null
            ? '-'
            : (x / 1000).toFixed(2) + 's'
    );

    $('#info').textContent =
        `${players[w].name} tercepat (${t[0]} vs ${t[1]})`;

    const A = $(`#c${w}`);

    setSprite(w, 'attacking');
    A.classList.add('l' + w);

    const LAUNCH = 150;
    const IMPACT = LAUNCH + THROW_MS;

    setTimeout(
        () => throwCarats(w, 1 - w),
        LAUNCH
    );

    setTimeout(() => {
        // Prefer actual HP damage after mitigation.
        // Fallback supports an older backend during deployment.
        const damageToShow =
            m.actualDamage || m.hit || [0, 0];

        damageToShow.forEach((d, i) => {
            if (d > 0) {
                setSprite(i, 'damaged');

                $(`#c${i}`).classList.add('hit');

                pop(i, `-${d}`, 'dmg');
            }
        });

        m.ev.forEach(e => {
            const messages = {
                crit: 'CRIT x2!',
                immune: 'IMMUNE!',
                reflect: 'SPLIT 50%!',
                heal: `HEAL +${e.v}`,
                ramp: `DMG +${e.v}`,
                shield: `SHIELD +${e.v}`,
                revive: 'REVIVE!',
                quick: 'QUICK DRAW!',
                lenbonus: `LEN +${e.v}`
            };

            pop(
                e.slot,
                messages[e.t],
                ['heal', 'revive'].includes(e.t)
                    ? 'heal'
                    : ''
            );
        });

        m.shield.forEach((s, i) => {
            if ((players[i].shield || 0) > 0 && s === 0) {
                pop(i, 'SHIELD BREAK!');
            }

            players[i].shield = s;
        });

        m.hp.forEach((h, i) => {
            setHp(i, h, m.shield[i]);
        });
    }, IMPACT);

    setTimeout(() => {
        players.forEach((_, i) => {
            setSprite(i, 'idle');
        });

        A.classList.remove('l' + w);

        document.querySelectorAll('.char').forEach(c => {
            c.classList.remove('hit');
        });
    }, IMPACT + 1250);
}

function over(text) {
    $('#over h2').textContent = text;
    $('#over').hidden = false;
    $('#game').hidden = false;
}