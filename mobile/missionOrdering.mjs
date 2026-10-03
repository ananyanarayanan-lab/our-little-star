export const MISSION_ROW_HEIGHT = 84
export const MISSION_ROW_GAP = 14
export const MISSION_ROW_STEP = MISSION_ROW_HEIGHT + MISSION_ROW_GAP

export function sortMissions(missions) {
  return [...missions].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))
}

export function moveMission(ids, from, to) {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return [...ids]
  const result = [...ids]
  const [id] = result.splice(from, 1)
  result.splice(to, 0, id)
  return result
}

export function dragDestination(from, delta, count) {
  return Math.max(0, Math.min(count - 1, from + Math.round(delta / MISSION_ROW_STEP)))
}

export function missionRowOffset(index, from, to) {
  if (from < to && index > from && index <= to) return -MISSION_ROW_STEP
  if (from > to && index >= to && index < from) return MISSION_ROW_STEP
  return 0
}

export async function saveMissionOrder(client, familyId, before, after) {
  if (before.length === after.length && before.every((id, index) => id === after[index])) return null
  const { data, error } = await client.rpc('reorder_missions', { p_family_id: familyId, p_mission_ids: after })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== after.length) throw new Error('Could not verify the saved mission order. Refresh and try again.')
  return data
}
