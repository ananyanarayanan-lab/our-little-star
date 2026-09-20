export default function RewardSetting({ balance, reward, onManage }) {
  const remaining = reward ? Math.max(0, reward.cost - balance) : 0
  return <aside className="reward-card" aria-labelledby="reward-title">
    <p className="eyebrow">SOMETHING TO LOOK FORWARD TO</p>
    <div className="reward-art" aria-hidden="true">🎁<span>✦</span></div>
    <h2 id="reward-title">{reward ? reward.name : 'Choose your next goal'}</h2>
    {reward ? <>
      <span className="reward-cost">★ {reward.cost} stars</span>
      <div className="progress-label"><label htmlFor="reward-progress">Your next reward</label><strong>{Math.min(balance, reward.cost)} / {reward.cost}</strong></div>
      <progress id="reward-progress" value={Math.min(balance, reward.cost)} max={reward.cost} />
      <p className="reward-encouragement" role="status">{remaining === 0 ? 'Reward ready!' : `${remaining} more stars to your reward!`}</p>
      <p>A parent can redeem it in Manage rewards.</p>
    </> : <p>Select an available reward to work toward together.</p>}
    <button className="edit-button reward-edit" onClick={onManage}>Manage rewards</button>
  </aside>
}
