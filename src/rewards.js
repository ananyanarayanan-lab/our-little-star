export const rewardSuggestions = ['Movie night', 'Pick out a toy', 'Choose a bedtime story', 'Trip to the playground']
export function validateReward(reward) {
  if (typeof reward.name !== 'string' || !reward.name.trim()) throw new Error('Please enter a reward name.')
  if (!Number.isSafeInteger(reward.cost) || reward.cost <= 0) throw new Error('Choose a positive whole-number star cost.')
}
export function migrateRewards(state, legacyReward) {
  if (state.version === 3) {
    if (!Array.isArray(state.rewards) || !Array.isArray(state.redemptions)) throw new Error('Saved rewards could not be read. Your data has been kept.')
    state.rewards.forEach(validateReward)
    state.redemptions.forEach(validateReward)
    return state
  }
  if (legacyReward) validateReward(legacyReward)
  const reward = legacyReward ? { ...legacyReward, name: legacyReward.name.trim(), id: 'legacy-reward', archived: false } : null
  return { ...state, version: 3, rewards: reward ? [reward] : [], selectedRewardId: reward?.id ?? null, redemptions: [] }
}
export function saveReward(state, draft, id = crypto.randomUUID()) {
  validateReward(draft)
  const existing = state.rewards.find((reward) => reward.id === id)
  const reward = { id, name: draft.name.trim(), cost: draft.cost, archived: existing?.archived ?? false }
  return { ...state, rewards: existing ? state.rewards.map((item) => item.id === id ? reward : item) : [...state.rewards, reward] }
}
export function selectGoal(state, id) {
  if (id !== null && !state.rewards.some((reward) => reward.id === id && !reward.archived)) throw new Error('Choose an available reward.')
  return { ...state, selectedRewardId: id }
}
export function archiveReward(state, id, archived = true) {
  return { ...state, selectedRewardId: archived && state.selectedRewardId === id ? null : state.selectedRewardId,
    rewards: state.rewards.map((reward) => reward.id === id ? { ...reward, archived } : reward) }
}
// The confirmation keeps the exact price, balance and name the parent reviewed.
export function redeemReward(state, confirmation, timestamp = new Date().toISOString()) {
  const previous = state.redemptions.find((event) => event.id === confirmation.id)
  if (previous) {
    if (previous.rewardId !== confirmation.rewardId) throw new Error('This confirmation was already used for another reward.')
    return state
  }
  if (!confirmation.id) throw new Error('Please open a new redemption confirmation.')
  const reward = state.rewards.find((item) => item.id === confirmation.rewardId && !item.archived)
  if (!reward) throw new Error('This reward is no longer available.')
  if (reward.name !== confirmation.name || reward.cost !== confirmation.cost || state.balance !== confirmation.balance) throw new Error('The reward or balance changed. Cancel and review a new confirmation.')
  if (state.balance < reward.cost) throw new Error('Not enough stars for this reward. Keep completing missions!')
  return { ...state, balance: state.balance - reward.cost, redemptions: [...state.redemptions, {
    id: confirmation.id, rewardId: reward.id, name: reward.name, cost: reward.cost, timestamp,
  }] }
}
