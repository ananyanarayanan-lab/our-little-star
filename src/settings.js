export const nameKey = 'our-little-star-name-v1'
export const rewardKey = 'our-little-star-reward-v1'

export function readName() {
  try {
    return (localStorage.getItem(nameKey) || '').trim()
  } catch {
    return ''
  }
}

export function validReward(reward) {
  return typeof reward?.name === 'string' && reward.name.trim().length > 0
    && Number.isSafeInteger(reward.cost) && reward.cost > 0
}

export function readReward() {
  try {
    const reward = JSON.parse(localStorage.getItem(rewardKey))
    return validReward(reward) ? { name: reward.name.trim(), cost: reward.cost } : null
  } catch {
    return null
  }
}
