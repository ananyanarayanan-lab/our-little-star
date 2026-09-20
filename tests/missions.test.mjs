import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacy, saveMission, archiveMission, awardMission, undoCompletion, refreshDay, readProgress, storageKey, legacyKey } from '../src/progress.js'
const day = '2026-09-19'
const draft = { name: '  Make bed  ', emoji: '🛏️', stars: 2, frequency: 'once_daily' }
const fresh = () => saveMission(migrateLegacy(null, day), draft, 'bed')

test('new installs have no assigned suggestions; creation trims names', () => {
  assert.equal(migrateLegacy(null).missions.length, 0)
  assert.equal(fresh().missions[0].name, 'Make bed')
})
test('invalid name, star values, emoji and frequency are rejected', () => {
  for (const patch of [{ name: '   ' }, { stars: 0 }, { stars: -1 }, { stars: 1.5 }, { stars: NaN }, { stars: Infinity }, { frequency: 'weekly' }, { emoji: '' }]) {
    assert.throws(() => saveMission(fresh(), { ...draft, ...patch }, 'bed'))
  }
})
test('once-daily blocks extra awards; next day preserves history and balance', () => {
  const one = awardMission(fresh(), 'bed', day, 'one')
  assert.equal(awardMission(one, 'bed', day, 'two').balance, 2)
  const next = awardMission(one, 'bed', '2026-09-20', 'three')
  assert.equal(next.balance, 4)
  assert.equal(next.completions.length, 2)
  assert.equal(refreshDay(next, '2026-09-21').completions.length, 2)
})
test('repeatable awards stack; repeated event IDs do not award twice', () => {
  let state = saveMission(fresh(), { ...draft, frequency: 'repeatable' }, 'bed')
  state = awardMission(state, 'bed', day, 'one')
  state = awardMission(state, 'bed', day, 'two')
  assert.equal(awardMission(state, 'bed', day, 'two').balance, 4)
  state = undoCompletion(state, 'one')
  assert.equal(state.balance, 2)
  assert.equal(undoCompletion(state, 'one').balance, 2)
  assert.equal(state.completions.length, 2)
})
test('undo subtracts original award after editing, archiving and day rollover', () => {
  let state = awardMission(fresh(), 'bed', day, 'one')
  state = saveMission(state, { ...draft, name: 'New name', stars: 9 }, 'bed')
  state = archiveMission(state, 'bed')
  assert.equal(awardMission(state, 'bed', day, 'two').balance, 2)
  assert.equal(state.completions[0].name, 'Make bed')
  state = undoCompletion(refreshDay(state, '2026-09-20'), 'one')
  assert.equal(state.balance, 0)
  assert.equal(state.completions[0].stars, 2)
  assert.equal(state.completions[0].undone, true)
  state = archiveMission(state, 'bed', false)
  assert.equal(awardMission(state, 'bed', '2026-09-20', 'three').balance, 9)
})
test('undo reopens daily availability; repeatable to daily respects existing awards', () => {
  let state = awardMission(fresh(), 'bed', day, 'one')
  state = undoCompletion(state, 'one')
  assert.equal(awardMission(state, 'bed', day, 'two').balance, 2)
  state = saveMission(state, { ...draft, frequency: 'repeatable' }, 'bed')
  state = awardMission(state, 'bed', day, 'three')
  state = saveMission(state, draft, 'bed')
  assert.equal(awardMission(state, 'bed', day, 'four').balance, 2)
})
test('legacy migration preserves accumulated balance and known completed starters', () => {
  const legacy = { day, balance: 42, completed: ['teeth', 'toys', 'toys'] }
  const state = migrateLegacy(legacy, '2026-09-20')
  assert.equal(state.balance, 42)
  assert.equal(state.missions.length, 4)
  assert.equal(state.completions.length, 2)
  assert.equal(state.completions[0].day, day)
  assert.equal(undoCompletion(state, `legacy-${day}-toys`).balance, 40)
  assert.deepEqual(legacy.completed, ['teeth', 'toys', 'toys'])
})
test('save/reload keeps edits, archive and history without touching legacy/name/reward keys', () => {
  const data = new Map([[legacyKey, JSON.stringify({ day, balance: 10, completed: ['teeth'] })], ['our-little-star-name-v1', 'Sally'], ['our-little-star-reward-v1', '{"name":"Toy","cost":10}']])
  const storage = { getItem: key => data.get(key) ?? null }
  const originals = [...data.entries()]
  let state = readProgress(storage)
  state = archiveMission(saveMission(state, draft, 'bed'), 'teeth')
  data.set(storageKey, JSON.stringify(state))
  assert.deepEqual(readProgress(storage), state)
  for (const [key, value] of originals) assert.equal(data.get(key), value)
  assert.equal(readProgress(storage).missions.length, 5)
})
test('corrupted or inaccessible storage fails without silently replacing progress', () => {
  assert.throws(() => readProgress({ getItem: () => '{broken' }))
  assert.throws(() => readProgress({ getItem: () => { throw new Error('blocked') } }))
})
test('undo refuses negative balances', () => {
  const state = awardMission(fresh(), 'bed', day, 'one')
  assert.throws(() => undoCompletion({ ...state, balance: 0 }, 'one'))
})
