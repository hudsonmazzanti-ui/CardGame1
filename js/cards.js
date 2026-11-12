'use strict';
/*
  DISPATCH — card pool.

  This is the file to edit when you want to tweak cards.
  Numbers in {braces} inside `text` are filled in from the card's own fields,
  so changing `dmg: 4` to `dmg: 3` updates the rules text too.

  Fields
    type     unit | spell | trap  (hex is a token, not in the pool)
    cost     resources to play
    pitch    resources it gives when pitched (0 = can't be pitched)
    atk, hp  unit stats
  Keyword flags
    taunt, rush, blood (Bloodcost), disguise (flip cost), temper (bonus per pitch)
  Card-specific numbers live in their own fields (dmg, prevent, life, ...).
  The rules engine looks up behaviour by card id, so keep the ids stable.

  Bump RULES_VERSION whenever you change a number, so old game links
  keep playing with the rules they started with.
*/
const RULES_VERSION = 4;   // 2: eight new cards. 3: six pitch-2 cards, four cards now pitch for 1. 4: graveyard and combo cards, reshuffling a stuck hand.

const CARDS = {
  // Forge — cards that grow when you pitch them
  whelp:      { name: 'Ember Whelp', type: 'unit', cost: 0, pitch: 2, atk: 1, hp: 1, temper: 2,
                text: 'Temper: +{temper}/+{temper}.' },
  golem:      { name: 'Forge Golem', type: 'unit', cost: 4, pitch: 1, atk: 5, hp: 5, temper: 2,
                text: 'Temper: costs {temper} less.' },
  whetstone:  { name: 'Whetstone Strike', type: 'spell', cost: 1, pitch: 2, dmg: 1, temper: 1, target: 'any',
                text: 'Deal {dmg} damage to a unit or your opponent. Temper: +{temper} damage.' },
  aegis:      { name: 'Tempered Aegis', type: 'trap', cost: 0, pitch: 2, prevent: 2, temper: 2,
                text: 'The first attack on you deals {prevent} less. Temper: prevents {temper} more.' },

  // Masks — hidden information
  assassin:   { name: 'Masked Assassin', type: 'unit', cost: 2, pitch: 1, atk: 3, hp: 2, disguise: 1,
                text: 'Disguise {disguise}. When revealed: destroy a damaged enemy unit.' },
  doppel:     { name: 'Doppelganger', type: 'unit', cost: 3, pitch: 1, atk: 1, hp: 1, disguise: 2,
                text: 'Disguise {disguise}. When revealed: become a copy of an enemy unit.' },
  calledshot: { name: 'Called Shot', type: 'trap', cost: 1, pitch: 1,
                text: 'Name a cost from 0 to 4. The first card your opponent plays with that cost is cancelled and goes to the bottom of their deck.' },
  turncoat:   { name: 'Turncoat', type: 'trap', cost: 3, pitch: 1, max: 3,
                text: 'When your opponent plays a unit that costs {max} or less, take control of it.' },
  reflect:    { name: 'Reflect', type: 'trap', cost: 2, pitch: 1,
                text: 'When your opponent casts a spell, cancel it. If it would have dealt damage, it hits them instead.' },
  pitfall:    { name: 'Pitfall', type: 'trap', cost: 1, pitch: 1, dmg: 4,
                text: 'When an enemy unit attacks, deal {dmg} damage to it first.' },

  // Blood — life as currency
  knight:     { name: 'Blood Knight', type: 'unit', cost: 3, pitch: 0, atk: 4, hp: 4, blood: true,
                text: 'Bloodcost.' },
  zealot:     { name: 'Ashen Zealot', type: 'unit', cost: 1, pitch: 1, atk: 2, hp: 1, rush: true, dmg: 2,
                text: 'Rush. When it dies, deal {dmg} damage to your opponent.' },
  bloodprice: { name: 'Blood Price', type: 'spell', cost: 0, pitch: 0, life: 4, target: 'unit',
                text: 'Destroy a unit. You lose {life} life.' },
  quickstep:  { name: 'Quickstep', type: 'spell', cost: 1, pitch: 1, target: 'attacked',
                text: 'One of your units that already attacked this turn can attack again.' },

  // Time
  titan:      { name: 'Patient Titan', type: 'unit', cost: 6, pitch: 1, atk: 7, hp: 7,
                text: 'Costs 1 less for each of your turns it spends in your hand.' },
  lancer:     { name: 'Twilight Lancer', type: 'unit', cost: 2, pitch: 1, atk: 2, hp: 3, bonus: 3,
                text: 'Finale: gains +{bonus} attack and Rush.' },
  curtain:    { name: 'Curtain Call', type: 'spell', cost: 3, pitch: 0, dmg: 3, finale: 7, blood: true,
                text: 'Bloodcost. Deal {dmg} damage to your opponent. Finale: {finale} instead.' },

  // Battlefield
  sergeant:   { name: 'Shieldwall Sergeant', type: 'unit', cost: 2, pitch: 1, atk: 2, hp: 4, taunt: true,
                text: 'Taunt. Units next to it have Taunt.' },
  wyrm:       { name: 'Tunneling Wyrm', type: 'unit', cost: 3, pitch: 1, atk: 4, hp: 3,
                text: "Burrowed: can't be attacked or targeted until it attacks. Burrows again after a turn it doesn't attack." },
  feeder:     { name: 'Carrion Feeder', type: 'unit', cost: 2, pitch: 1, atk: 1, hp: 3,
                text: 'Whenever another unit dies, gains +1/+1.' },
  pass:       { name: 'Narrow Pass', type: 'spell', terrain: true, cost: 1, pitch: 1, max: 2,
                text: 'Terrain. Each player can attack with at most {max} units per turn.' },
  field:      { name: 'Ember Field', type: 'spell', terrain: true, cost: 1, pitch: 1, dmg: 1,
                text: 'Terrain. At the end of every turn, deal {dmg} damage to each unit.' },

  // Digital-only
  witch:      { name: "Witch's Mark", type: 'spell', cost: 1, pitch: 1,
                text: "Put a Hex into your opponent's hand." },
  map:        { name: "Scavenger's Map", type: 'spell', cost: 1, pitch: 1,
                text: "Choose 1 of 3 random cards that aren't in your deck. It joins your hand at the end of your turn." },

  // ----- Set 2 -----
  // Forge
  apprentice: { name: 'Forgehand Apprentice', type: 'unit', cost: 1, pitch: 1, atk: 1, hp: 3, since: 2,
                text: 'Whenever you pitch a card, gains +1 attack this turn.' },
  drake:      { name: 'Bellows Drake', type: 'unit', cost: 2, pitch: 2, atk: 2, hp: 2, temper: 1, since: 2,
                text: 'Temper: +{temper}/+{temper}. Has Rush once it has been Tempered.' },
  greatforge: { name: 'The Great Forge', type: 'spell', terrain: true, cost: 1, pitch: 1, since: 2,
                text: 'Terrain. Pitching a card Tempers it twice.' },
  hone:       { name: 'Hone', type: 'spell', cost: 1, pitch: 2, bonus: 2, temper: 1, target: 'own', since: 2,
                text: 'One of your units gets +{bonus} attack. Temper: +{temper} more.' },

  // Memory and mind games
  wraith:     { name: 'Echo Wraith', type: 'unit', cost: 2, pitch: 1, atk: 2, hp: 2, since: 2,
                text: 'When it dies, it goes to the bottom of your deck and comes back +1/+1 stronger each time.' },
  omen:       { name: 'Omen', type: 'trap', cost: 1, pitch: 1, life: 4, since: 2,
                text: 'When set, predict whether your opponent attacks you on their next turn. If you’re right, gain {life} life at the end of it.' },
  tape:       { name: 'Red Tape', type: 'spell', cost: 1, pitch: 1, tax: 2, since: 2,
                text: 'The first card your opponent plays next turn costs {tax} more.' },
  sender:     { name: 'Return to Sender', type: 'trap', cost: 2, pitch: 1, since: 2,
                text: 'When an enemy unit attacks you, return it to its owner’s hand instead.' },

  // ----- Set 3: dependable cards that pitch for 2 -----
  runner:     { name: 'Postal Runner', type: 'unit', cost: 1, pitch: 2, atk: 2, hp: 1, rush: true, since: 3,
                text: 'Rush.' },
  pigeon:     { name: 'Carrier Pigeon', type: 'unit', cost: 0, pitch: 2, atk: 1, hp: 1, evade: true, since: 3,
                text: 'Flies over Taunt: it can attack anything.' },
  recruit:    { name: 'Bulwark Recruit', type: 'unit', cost: 2, pitch: 2, atk: 2, hp: 3, taunt: true, since: 3,
                text: 'Taunt.' },
  flare:      { name: 'Signal Flare', type: 'spell', cost: 1, pitch: 2, dmg: 2, target: 'unit', since: 3,
                text: 'Deal {dmg} damage to a unit.' },
  rations:    { name: 'Field Rations', type: 'spell', cost: 1, pitch: 2, life: 3, since: 3,
                text: 'Gain {life} life.' },
  tripwire:   { name: 'Tripwire', type: 'trap', cost: 0, pitch: 2, dmg: 2, since: 3,
                text: 'When an enemy unit attacks, deal {dmg} damage to it first.' },

  // ----- Set 4: graveyard and combo -----
  ghoul:      { name: 'Restless Ghoul', type: 'unit', cost: 1, pitch: 2, atk: 1, hp: 1, haunt: 2, since: 4,
                text: 'Haunt: you can play it from your discard pile for {haunt} more.' },
  collector:  { name: 'Bone Collector', type: 'unit', cost: 2, pitch: 1, atk: 1, hp: 2, max: 4, since: 4,
                text: 'Enters with +1/+1 for every 2 cards in your discard pile (up to +{max}/+{max}).' },
  requiem:    { name: 'Requiem', type: 'spell', cost: 3, pitch: 1, dmg: 2, max: 8, since: 4,
                text: 'Deal {dmg} damage to your opponent, plus 1 for each card in your discard pile (up to {max} total).' },
  rites:      { name: 'Last Rites', type: 'spell', cost: 1, pitch: 2, target: 'own', since: 4,
                text: 'Destroy one of your units. Deal damage equal to its attack to your opponent.' },
  overcharge: { name: 'Overcharge', type: 'spell', cost: 1, pitch: 1, target: 'own', since: 4,
                text: 'Double one of your units’ attack this turn.' },

  // Token
  hex:     { name: 'Hex', type: 'hex', cost: 1, pitch: 0, life: 2, token: true,
                text: "Can't be pitched. Play it to get rid of it. If it's in your hand at the end of your turn, lose {life} life." },
};

const KEYWORDS = {
  Temper: 'Each time you pitch this card, it permanently gets the bonus. The game remembers it as the card cycles through your deck.',
  Disguise: 'You can play this face-down for 1 as a blank 2/2. On a later turn, pay the Disguise cost to flip it.',
  Bloodcost: 'You can pay any part of the cost with 2 life per resource.',
  Finale: 'The bonus applies when you play it on your 5th turn.',
  Taunt: 'Enemies must attack units with Taunt first.',
  Rush: 'Can attack the turn it is played.',
  Terrain: 'Stays in play and affects both players. A new Terrain replaces the old one.',
  Haunt: 'You can play this card from your discard pile by paying the extra cost.',
};

const PRESET_DECKS = [
  { name: 'The Forge',     cards: ['whelp', 'whetstone', 'aegis', 'golem', 'feeder', 'sergeant', 'map', 'pass', 'pitfall', 'titan'] },
  { name: 'Blood Rush',    cards: ['knight', 'zealot', 'bloodprice', 'quickstep', 'lancer', 'curtain', 'whelp', 'whetstone', 'runner', 'calledshot'] },
  { name: 'Masquerade',    cards: ['assassin', 'doppel', 'calledshot', 'pitfall', 'reflect', 'turncoat', 'witch', 'pigeon', 'whelp', 'aegis'] },
  { name: 'The Long Game', cards: ['titan', 'sergeant', 'recruit', 'pass', 'pitfall', 'feeder', 'bloodprice', 'rations', 'aegis', 'whetstone'] },
  { name: 'Foundry',       cards: ['apprentice', 'drake', 'greatforge', 'hone', 'whelp', 'golem', 'whetstone', 'aegis', 'wraith', 'sender'] },
  { name: 'Red Tape',      cards: ['tape', 'omen', 'calledshot', 'sender', 'wraith', 'sergeant', 'zealot', 'lancer', 'curtain', 'map'] },
  { name: 'Catapult',      cards: ['golem', 'titan', 'apprentice', 'hone', 'overcharge', 'rites', 'sergeant', 'whelp', 'recruit', 'map'] },
  { name: 'Ossuary',       cards: ['ghoul', 'collector', 'requiem', 'rites', 'zealot', 'feeder', 'bloodprice', 'flare', 'runner', 'tripwire'] },
  { name: 'Postmaster',    cards: ['tape', 'witch', 'calledshot', 'sender', 'pass', 'pigeon', 'runner', 'recruit', 'omen', 'tripwire'] },
];

/*
  Old numbers, so games started on an earlier rules version replay exactly as they were played.
  LEGACY[v] lists what changed *after* version v. A game on version v uses these values.
*/
const LEGACY = {
  2: { turncoat: { pitch: 0 }, reflect: { pitch: 0 }, quickstep: { pitch: 0 }, titan: { pitch: 0 } },
};
const CURRENT = JSON.parse(JSON.stringify(CARDS));
let rulesInUse = RULES_VERSION;
function useRules(v) {
  v = v || 1;
  if (v === rulesInUse) return;
  for (const id in CURRENT) Object.assign(CARDS[id], CURRENT[id]);
  for (const k of Object.keys(LEGACY).map(Number).sort((a, b) => b - a)) {
    if (v <= k) for (const [id, patch] of Object.entries(LEGACY[k])) Object.assign(CARDS[id], patch);
  }
  rulesInUse = v;
}

function cardText(id) {
  const c = CARDS[id];
  return c.text.replace(/\{(\w+)\}/g, (_, k) => c[k]);
}
