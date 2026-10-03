import test from 'node:test'
import assert from 'node:assert/strict'
import { sortMissions, moveMission, dragDestination, missionRowOffset, saveMissionOrder, MISSION_ROW_STEP } from '../mobile/missionOrdering.mjs'

test('saved positions sort consistently without mutating missions', () => {
  const rows = [{ id: 'a', sort_order: 30 }, { id: 'b', sort_order: 10 }, { id: 'c', sort_order: 20 }]
  assert.deepEqual(sortMissions(rows).map((m) => m.id), ['b', 'c', 'a'])
  assert.deepEqual(rows.map((m) => m.id), ['a', 'b', 'c'])
  assert.deepEqual(sortMissions([{ id: 'b', sort_order: 10, created_at: '2026-01-01' }, { id: 'a', sort_order: 10, created_at: '2026-01-01' }]).map((m) => m.id), ['a', 'b'])
})

test('drag position, sibling displacement and end boundaries are consistent', () => {
  assert.equal(dragDestination(1, MISSION_ROW_STEP * 1.8, 5), 3)
  assert.equal(dragDestination(1, -10000, 5), 0)
  assert.equal(dragDestination(1, 10000, 5), 4)
  assert.equal(missionRowOffset(2, 1, 3), -MISSION_ROW_STEP)
  assert.equal(missionRowOffset(0, 3, 0), MISSION_ROW_STEP)
  assert.equal(missionRowOffset(4, 1, 3), 0)
  assert.deepEqual(moveMission(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(moveMission(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
  assert.deepEqual(moveMission(['a', 'b'], 0, -1), ['a', 'b'])
})

test('one RPC persists a changed order; unchanged drops do not write', async () => {
  const calls = []
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: args.p_mission_ids.map((id, i) => ({ id, sort_order: (i + 1) * 10 })) } } }
  assert.equal(await saveMissionOrder(client, 'family', ['a', 'b'], ['a', 'b']), null)
  assert.equal(calls.length, 0)
  assert.deepEqual(await saveMissionOrder(client, 'family', ['a', 'b'], ['b', 'a']), [{ id: 'b', sort_order: 10 }, { id: 'a', sort_order: 20 }])
  assert.deepEqual(calls, [{ name: 'reorder_missions', args: { p_family_id: 'family', p_mission_ids: ['b', 'a'] } }])
})

test('server rejection and incomplete responses cannot masquerade as saved order', async () => {
  await assert.rejects(saveMissionOrder({ rpc: async () => ({ error: new Error('Family access denied') }) }, 'family', ['a', 'b'], ['b', 'a']), /Family access denied/)
  await assert.rejects(saveMissionOrder({ rpc: async () => ({ data: [] }) }, 'family', ['a', 'b'], ['b', 'a']), /verify the saved/)
})
