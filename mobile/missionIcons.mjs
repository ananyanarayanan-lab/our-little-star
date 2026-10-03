export const missionIconOptions = [
  ['potty', '🚽', 'Potty'], ['clothes', '👕', 'Clothes'], ['toothbrush', '🪥', 'Toothbrush'], ['food', '🥣', 'Food'],
  ['cat', '🐱', 'Cat'], ['pet', '🐶', 'Pet'], ['toys', '🧸', 'Toys'], ['laundry', '🧺', 'Laundry'],
  ['dishes', '🍽️', 'Dishes'], ['bed', '🛏️', 'Bed'], ['book', '📚', 'Book'], ['shoes', '👟', 'Shoes'],
  ['backpack', '🎒', 'Backpack'], ['helping', '🤝', 'Helping'], ['cleaning', '🧹', 'Cleaning'], ['star', '⭐', 'Star'], ['check', '✅', 'Check'],
  ['poop', '\u{1f4a9}', 'Poop'],
  ['pee', '\u{1f4a7}', 'Pee'],
  ['toilet', '\u{1f6bd}', 'Toilet'],
  ['bath', '\u{1f6c1}', 'Bath'],
  ['wash_hands', '\u{1f9fc}', 'Wash hands'],
  ['hair', '\u{1faae}', 'Hair'],
  ['pajamas', '\u{1f319}', 'Pajamas'],
  ['wake_up', '\u{1f305}', 'Wake up'],
  ['breakfast', '\u{1f373}', 'Breakfast'],
  ['snack', '\u{1f34e}', 'Snack'],
  ['water', '\u{1f6b0}', 'Water'],
  ['cup', '\u{1f964}', 'Cup'],
  ['plate', '\u{1f37d}', 'Plate'],
  ['broom', '\u{1f9f9}', 'Broom'],
  ['trash', '\u{1f5d1}', 'Trash'],
  ['tidy', '\u{1f4e6}', 'Tidy'],
  ['homework', '\u{1f4dd}', 'Homework'],
  ['drawing', '\u{1f3a8}', 'Drawing'],
  ['school', '\u{1f3eb}', 'School'],
  ['dog', '\u{1f436}', 'Dog'],
  ['family', '\u{1f46a}', 'Family'],
  ['heart', '\u{2764}', 'Heart'],
  ['smile', '\u{1f60a}', 'Smile'],
  ['trophy', '\u{1f3c6}', 'Trophy'],
]
const missionIconByKey = Object.fromEntries(missionIconOptions.map(([key, emoji]) => [key, emoji]))

// Only curated stable keys enter persistence; glyphs live exclusively in this module.
export function missionVisualFields(iconKey) {
  if (!Object.hasOwn(missionIconByKey, iconKey)) throw new Error('Choose a valid mission icon.')
  return { icon_key: iconKey }
}

export function missionIcon(mission) {
  return Object.hasOwn(missionIconByKey, mission.icon_key) ? missionIconByKey[mission.icon_key] : missionIconByKey.star
}

export function completionIcon(event) {
  // Emoji fallback is restricted to historical rows without a key snapshot.
  return event.icon_key_snapshot != null
    ? missionIcon({ icon_key: event.icon_key_snapshot })
    : event.emoji_snapshot || missionIconByKey.star
}
