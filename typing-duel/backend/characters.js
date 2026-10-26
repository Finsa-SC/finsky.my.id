// Abilities are authoritative on the server.
// Keys must match the "id" in frontend/characters/characters.json (and the folder name).
module.exports = {
  // Win a round with zero typos -> damage x1.5
  'daiwa-scarlet': { cleanWin: 1.5 },

  // Stacks (max 10): +2 when hit, +1 when attacking. Each stack cuts damage taken by 5%.
  // Hit at 10 stacks -> immune, stacks drop to 5. Attack at 10 stacks -> damage x2, stacks reset to 0.
  'special-week':  { stacks: { max: 10, onHit: 2, onAttack: 1, reduce: 0.05, dropTo: 5 } },

  // Parry window starts at gap (0.3s), +growAtk when she wins, +growHit when she loses without parrying, resets to gap when a parry triggers.
  // Lose by <= window -> parry: she takes 50%, attacker takes 100%.
  // Lose by <= perfect.gap -> PERFECT parry: attacker takes damage x reflect, she takes 0 and heals (damage she would have taken * healFrac).
  'meisho-dotto':  { parry: { gap: 0.3, growAtk: 0.1, growHit: 0.2, perfect: { gap: 0.3, reflect: 1.5, healFrac: 0.5 } } },

  // 30% flashbang at the start of each round + instant flashbang on every enemy typo
  'haru-urara':    { flash: 0.30, flashMs: 200, typoFlash: true },

  // Holy Seed: +1 seed per round won. Each seed cuts damage taken by 2 (so in practice max 1 seed is ever held).
  // At 2 seeds the seeds burst -> heal 15, seeds reset to 0. Revive once at 20 HP.
  'almond-eye':    { seed: { burst: 2, heal: 15, reduce: 2 }, revive: 20 },

  'agnes-tachyon': { timeHeal: { mult: 8, max: 8 } },                 // win -> heal = time gap (s) * 8, min 1, max 8
  // Anger of Warrior: starts with 50% damage reduction; every attack strips 5% of it. At 0% every attack gives permanent +1 damage.
  // Also every 3rd round -> permanent +1 damage.
  'tokai-teio':    { reduction: { start: 50, step: 10, bonus: 1 }, ramp: { every: 3, amount: 1 } },
  'oguri-cap':     { shield: 20, brokenCap: 8 },                      // 20 shield; any damage reaching HP capped at 8

  // Win -> shield = 12% of missing HP (max 10 per win, total cap 30). While shielded: +1 damage per 5 shield.
  'tm-opera-o':    { winShield: { mult: 0.12, max: 10, cap: 30 }, shieldDmg: { div: 5 } },

  'gold-ship':     { lenBonus: { over: 5, shield: 2, dmg: 1, cap: 30 } }, // each letter beyond 5: +2 shield, +1 damage (on win)
  'matikanefukukitaru': { quickDraw: { under: 600, bonus: 3, pierceBonus: 3 } }, // win a round + first correct letter under 0.6s: +3 dmg, +3 more & pierce shield

  // Poison Mark: winning puts `perWin` marks on the enemy (capped by capacity, which starts at `max`). From the next round on, marks explode every round as TRUE damage
  // (ignores shield / reductions / caps, never counts as being hit). Explosions = 1 + 1 per `gapStep` seconds Diamond wins by (loser didn't finish -> all marks).
  // Damage per explosion = base + roundBonus per `roundEvery` rounds. Every `growEvery` poison hits the enemy takes: capacity +1 and Diamond heals `capHeal`.
  'satono-diamond': { poison: { base: 2, roundEvery: 5, roundBonus: 1, max: 1, perWin: 2, growEvery: 5, capHeal: 10, gapStep: 0.5 } },

  // Counter-healer + Iron Mirror: every 5th round, if the enemy did not heal in that 5-round window,
  // the next hit she takes is converted into healing (effect is consumed when she is hit).
  'gentildonna':   { counter: { cap: 10 }, ironMirror: { every: 5 } }
};