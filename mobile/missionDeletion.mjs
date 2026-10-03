// Keep the mission row and all ledger references; only hide it from active lists.
export async function softDeleteMission(client, missionId) {
  const { data, error } = await client.from('missions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', missionId).select('id').single()
  if (error) throw error
  if (!data || data.id !== missionId) throw new Error('Could not delete this mission. Please try again.')
}
