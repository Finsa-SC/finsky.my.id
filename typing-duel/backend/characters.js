// Abilities are authoritative on the server. Chances are 0..1.
module.exports = {
  'daiwa-scarlet': { crit: 0.25 },
  'special-week':   { immune: 0.35 },
  'meisho-dotto':  { reflect: 0.25 },
  'haru-urara':      { flash: 0.30 },
  'almond-eye':     { heal: { after: 2, amount: 8 } }
};
