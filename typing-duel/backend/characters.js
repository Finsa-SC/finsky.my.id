// Abilities are authoritative on the server.
// Keys must match the "id" in frontend/characters/characters.json (and the folder name).
module.exports = {
  // Win a round with zero typos -> damage x1.5
  'daiwa-scarlet': { cleanWin: 1.5 },

  // Stacks (max 10): +2 when hit, +1 when attacking. Each stack cuts damage taken by 5%.
  // Hit at 10 stacks -> immune, stacks drop to 5. Attack at 10 stacks -> damage x2, stacks reset to 0.
  'special-week':  { stacks: { max: 10, onHit: 2, onAttack: 1, reduce: 0.05, dropTo: 5 } },

  // Loses a round by <= 0.3s -> parry: she takes 50%, attacker takes 100%
  'meisho-dotto':  { parry: { gap: 0.3 } },

  // 30% flashbang at the start of each round + instant flashbang on every enemy typo
  'haru-urara':    { flash: 0.30, flashMs: 200, typoFlash: true },

  'almond-eye':    { heal: { after: 2, amount: 8 }, revive: 20 },     // heal after 2 hit-free rounds; revive once at 20 HP
  'agnes-tachyon': { timeHeal: { mult: 8, max: 8 } },                 // win -> heal = time gap (s) * 8, min 1, max 8
  'tokai-teio':    { ramp: { every: 4, amount: 2 } },                 // every 4th round -> permanent +2 damage
  'oguri-cap':     { shield: 20, brokenCap: 8 },                      // 20 shield; any damage reaching HP capped at 8

  // Win -> shield = 12% of missing HP (max 8 per win, total cap 20). While shielded: +1 damage per 5 shield.
  'tm-opera-o':    { winShield: { mult: 0.12, max: 8, cap: 20 }, shieldDmg: { div: 5 } },

  'gold-ship':     { lenBonus: { over: 5, shield: 2, dmg: 1, cap: 30 } }, // each letter beyond 5: +2 shield, +1 damage (on win)
  'matikanefukukitaru': { quickDraw: { under: 500, bonus: 3, pierceBonus: 3 } }, // win a round + first correct letter under 0.5s: +3 dmg, +3 more & pierce shield

  // Counter-healer: winning after the enemy healed -> bonus damage and self-heal equal to the enemy's accumulated heal (capped)
  'gentildonna':   { counter: { cap: 10 } }
};