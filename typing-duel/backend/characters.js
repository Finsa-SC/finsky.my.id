// Abilities are authoritative on the server. Chances are 0..1.
// Keys must match the "id" in frontend/characters/characters.json (and the folder name).
module.exports = {
  'daiwa-scarlet': { crit: 0.25 },                                   // damage x2
  'special-week':  { immune: 0.35 },                                 // immune when attacked
  'meisho-dotto':  { reflect: 0.25 },                                // she takes 50%, attacker takes 100% (incl. crit)
  'haru-urara':    { flash: 0.30, flashMs: 500 },                    // flashbang enemy each round for 0.5s
  'almond-eye':    { heal: { after: 2, amount: 15 }, revive: 20 },    // heal after 2 hit-free rounds; revive once at 20 HP
  'agnes-tachyon': { timeHeal: { mult: 8, max: 8 } },                // win -> heal = time gap (s) * 8, min 1, max 8
  'tokai-teio':    { ramp: { every: 4, amount: 2 } },                // every 4th round -> permanent +2 damage
  'oguri-cap':     { shield: 20, brokenCap: 8 },                     // 20 shield; after it breaks, HP damage per hit capped at 8
  'tm-opera-o':    { winShield: { mult: 0.12, max: 8, cap: 20 } },   // win -> shield = 12% of missing HP (max 8, total cap 20)
  'gold-ship':     { lenBonus: { over: 5, shield: 2, dmg: 1, cap: 30 } }, // each letter beyond 5: +2 shield, +1 damage (on win)
  'matikanefukukitaru': { quickDraw: { under: 500, bonus: 3, pierceBonus: 3 } } // every round: win under 0.5s -> +3 dmg, +3 more & pierce shield
};