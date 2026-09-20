import { migrateRewards } from './rewards.js'
import { rewardKey } from './settings.js'

export const storageKey = 'our-little-star-progress-v3'
export const missionStorageKey = 'our-little-star-missions-v2'
export const legacyKey = 'our-little-star-progress-v1'
export const suggestions = [
  { name: 'Brush teeth', stars: 1, emoji: '🪥', id: 'teeth' },
  { name: 'Put toys away', stars: 2, emoji: '🧸', id: 'toys' },
  { name: 'Help set the table', stars: 2, emoji: '🍽️', id: 'table' },
  { name: 'Get dressed', stars: 1, emoji: '👕', id: 'clothes' },
]
export const emojiOptions = [
  ['⭐', 'Star'], ['💩', 'Poop'], ['🚽', 'Toilet'], ['🪥', 'Toothbrush'],
  ['🧸', 'Teddy bear'], ['👕', 'Shirt'], ['🛏️', 'Bed'], ['🍽️', 'Place setting'],
  ['🧺', 'Laundry'], ['❤️', 'Kindness / love'], ['👐', 'Safe hands'],
  ['🥣', 'Ate by myself'], ['🐱', 'Kitty cat'],
  ['🧼', 'Wash hands'], ['🛁', 'Bath time'], ['🧴', 'Lotion / self-care'],
  ['🧹', 'Sweep'], ['🧽', 'Wipe up'], ['🗑️', 'Put rubbish away'],
  ['👟', 'Put shoes on'], ['🧦', 'Put socks on'], ['🎒', 'Get bag ready'],
  ['📚', 'Reading'], ['✏️', 'Learning time'], ['🎨', 'Art / creativity'],
  ['🧩', 'Finish a puzzle'], ['💧', 'Drink water'], ['🥦', 'Eat vegetables'],
  ['🍎', 'Eat fruit'], ['🤝', 'Sharing / helping'], ['🐶', 'Care for a pet'],
  ['🌱', 'Water plants'], ['😴', 'Bedtime routine'],
]
export function getToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function refreshDay(state, day = getToday()) {
  return state.day === day ? state : { ...state, day }
}
export function validateMission(mission) {
  if (!mission.name.trim()) throw new Error('Please enter a mission name.')
  if (!Number.isSafeInteger(mission.stars) || mission.stars <= 0) throw new Error('Stars must be a positive whole number.')
  if (!['once_daily', 'repeatable'].includes(mission.frequency)) throw new Error('Choose a frequency.')
  if (!emojiOptions.some(([emoji]) => emoji === mission.emoji)) throw new Error('Choose an emoji.')
}
// Keep the original key intact as a backup. Older days have only a total, not history.
export function migrateLegacy(saved, day = getToday()) {
  const empty = { version: 2, day, balance: 0, missions: [], completions: [] }
  if (!saved) return empty
  if (!Number.isSafeInteger(saved.balance) || saved.balance < 0 || !Array.isArray(saved.completed)) throw new Error('Saved progress could not be read. Your original data has been kept.')
  return {
    ...empty, balance: saved.balance,
    missions: suggestions.map((mission) => ({ ...mission, frequency: 'once_daily', archived: false })),
    completions: suggestions.filter((mission) => saved.completed.includes(mission.id)).map((mission) => ({
      id: `legacy-${saved.day}-${mission.id}`, missionId: mission.id, name: mission.name,
      emoji: mission.emoji, stars: mission.stars, day: saved.day, undone: false,
    })),
  }
}
export function readProgress(storage = localStorage) {
  const raw = storage.getItem(storageKey) ?? storage.getItem(missionStorageKey)
  if (!raw) return migrateRewards(migrateLegacy(JSON.parse(storage.getItem(legacyKey))), JSON.parse(storage.getItem(rewardKey)))
  const state = JSON.parse(raw)
  if (![2, 3].includes(state.version) || !Number.isSafeInteger(state.balance) || state.balance < 0 || !Array.isArray(state.missions) || !Array.isArray(state.completions)) throw new Error('Saved missions could not be read. Your data has been kept.')
  state.missions.forEach(validateMission)
  if (state.completions.some((event) => !Number.isSafeInteger(event.stars) || event.stars <= 0)) throw new Error('Saved history could not be read. Your data has been kept.')
  return refreshDay(migrateRewards(state, state.version === 3 ? null : JSON.parse(storage.getItem(rewardKey))))
}
export function saveMission(state, draft, id = crypto.randomUUID()) {
  validateMission(draft)
  const existing = state.missions.find((mission) => mission.id === id)
  const mission = { ...draft, name: draft.name.trim(), id, archived: existing?.archived ?? false }
  return { ...state, missions: existing ? state.missions.map((item) => item.id === id ? mission : item) : [...state.missions, mission] }
}
export function archiveMission(state, id, archived = true) {
  return { ...state, missions: state.missions.map((mission) => mission.id === id ? { ...mission, archived } : mission) }
}
export function todayCompletions(state, missionId) {
  return state.completions.filter((event) => event.missionId === missionId && event.day === state.day && !event.undone)
}
export function awardMission(state, missionId, day = getToday(), id = crypto.randomUUID()) {
  const current = refreshDay(state, day)
  const mission = current.missions.find((item) => item.id === missionId)
  if (!mission || mission.archived || current.completions.some((event) => event.id === id)) return current
  if (mission.frequency === 'once_daily' && todayCompletions(current, missionId).length) return current
  if (!Number.isSafeInteger(current.balance + mission.stars)) throw new Error('The star balance is too large to add more stars.')
  return { ...current, balance: current.balance + mission.stars, completions: [...current.completions, {
    id, missionId, name: mission.name, emoji: mission.emoji, stars: mission.stars, day, undone: false,
  }] }
}
export function undoCompletion(state, id) {
  const event = state.completions.find((item) => item.id === id)
  if (!event || event.undone) return state
  if (state.balance < event.stars) throw new Error(`Cannot undo this completion: it earned ${event.stars} stars, but only ${state.balance} remain after spending. Undo would make the balance negative.`)
  return { ...state, balance: state.balance - event.stars, completions: state.completions.map((item) => item.id === id ? { ...item, undone: true } : item) }
}
