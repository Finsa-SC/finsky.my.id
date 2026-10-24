// Abilities are authoritative on the server. Chances are 0..1.
// Keys must match the "id" in frontend/characters/characters.json (and the folder name).
module.exports = {
  'daiwa-scarlet': { crit: 0.25 },                         // damage x2
  'special-week':  { immune: 0.35 },                       // immune when attacked
  'meisho-dotto':  { reflect: 0.25 },                      // damage split 50/50 with attacker
  'haru-urara':    { flash: 0.30 },                        // flashbang enemy each round
  'almond-eye':    { heal: { after: 2, amount: 10 } },      // no damage for 2 rounds -> heal
  'agnes-tachyon': { timeHeal: { mult: 1.25, max: 8 } },     // win round -> heal = time gap (s) * mult, capped at max
  'tokai-teio':    { ramp: { every: 3, amount: 1 } },      // every 3rd round -> permanent +1 damage
  'oguri-cap':     { shield: 20 },                          // starts with a 20 shield
  'tm-opera-o': { winShield: { mult: 0.12, max: 8, cap: 20 } },  // win round -> shield = 12% of missing HP (max 8 per win, total cap 20)
};