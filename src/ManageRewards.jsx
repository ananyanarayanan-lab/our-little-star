import { useEffect, useRef, useState } from 'react'
import { archiveReward, redeemReward, rewardSuggestions, saveReward, selectGoal } from './rewards'

function Confirmation({ confirmation, onConfirm, onCancel }) {
  const dialog = useRef(null)
  const submitted = useRef(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  return <dialog ref={dialog} className="redemption-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-details" onCancel={onCancel}>
    <h2 id="confirm-title">Redeem this reward?</h2>
    <div id="confirm-details"><p className="confirmation-name">{confirmation.name}</p><p>Cost: <strong>{confirmation.cost} stars</strong></p><p>Balance now: {confirmation.balance} stars</p><p>Balance after redemption: <strong>{confirmation.balance - confirmation.cost} stars</strong></p></div>
    <p className="field-hint">Stars are spent only when you confirm. Redemptions cannot be undone here.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="edit-button" autoFocus onClick={onCancel}>Cancel</button><button className="complete-button" onClick={() => {
      if (submitted.current) return
      submitted.current = true
      try { onConfirm() } catch (problem) { submitted.current = false; setError(problem.message) }
    }}>Confirm redemption</button></div>
  </dialog>
}

export default function ManageRewards({ progress, onChange, onClose }) {
  const [draft, setDraft] = useState({ name: '', cost: '' })
  const [editingId, setEditingId] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const heading = useRef(null)
  const nameField = useRef(null)
  const redeemButton = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])
  function action(update, success) {
    try { onChange(update); setError(''); setMessage(success); return true }
    catch (problem) { setError(problem.message); return false }
  }
  function closeConfirmation() {
    setConfirmation(null)
    requestAnimationFrame(() => redeemButton.current?.focus())
  }
  function submit(event) {
    event.preventDefault()
    const id = editingId || crypto.randomUUID()
    if (action((state) => saveReward(state, { ...draft, cost: Number(draft.cost) }, id), editingId ? 'Reward updated.' : 'Reward added. You can select it as your goal.')) {
      setDraft({ name: '', cost: '' }); setEditingId(null); nameField.current?.focus()
    }
  }
  return <section className="mission-manager" aria-labelledby="manage-rewards-title">
    <div className="section-heading"><div><p className="eyebrow">FOR PARENTS</p><h2 id="manage-rewards-title" tabIndex={-1} ref={heading}>Manage rewards</h2></div><button className="edit-button" onClick={onClose}>Back to Today</button></div>
    <p className="section-description">Available balance: <strong>{progress.balance} stars</strong>. Pick a goal, or redeem any available reward.</p>
    {!progress.selectedRewardId && <p className="goal-notice" role="status">No active goal. Choose “Set as goal” on an available reward.</p>}
    <div className="manager-grid">
      <form className="settings-form mission-editor" onSubmit={submit}>
        <h3>{editingId ? 'Edit reward' : 'Create a reward'}</h3>
        {!editingId && <fieldset className="suggestions"><legend>Optional ideas — save only the ones you want</legend>{rewardSuggestions.map((name) => <button key={name} type="button" className="suggestion-button" onClick={() => { setDraft({ ...draft, name }); nameField.current?.focus() }}>{name}</button>)}</fieldset>}
        <label htmlFor="reward-name">Reward name</label><input ref={nameField} id="reward-name" required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <label htmlFor="reward-cost">Star cost</label><input id="reward-cost" type="number" inputMode="numeric" min="1" step="1" max={Number.MAX_SAFE_INTEGER} required value={draft.cost} onChange={(event) => setDraft({ ...draft, cost: event.target.value })} />
        <div className="form-actions"><button className="complete-button" type="submit">{editingId ? 'Save changes' : 'Add reward'}</button>{editingId && <button className="edit-button" type="button" onClick={() => { setEditingId(null); setDraft({ name: '', cost: '' }) }}>Cancel edit</button>}</div>
      </form>
      <section className="mission-library" aria-labelledby="reward-library-title"><h3 id="reward-library-title">Your rewards</h3>
        {!progress.rewards.length && <p className="empty-missions">No rewards yet. Add something your little star can look forward to.</p>}
        <ul className="chore-list">{progress.rewards.map((reward) => <li key={reward.id} className="chore-card"><div className="chore-detail"><h4>{reward.name}</h4><p>{reward.cost} stars{reward.archived ? ' · Archived' : progress.selectedRewardId === reward.id ? ' · Active goal' : ''}</p>
          <div className="form-actions"><button className="edit-button" aria-label={`Edit ${reward.name}`} onClick={() => { setDraft(reward); setEditingId(reward.id); nameField.current?.focus() }}>Edit</button>
          <button className="edit-button" aria-label={`${reward.archived ? 'Restore' : 'Archive'} ${reward.name}`} onClick={() => action((state) => archiveReward(state, reward.id, !reward.archived), reward.archived ? 'Reward restored.' : 'Reward archived. Redemption history is preserved.')}>{reward.archived ? 'Restore' : 'Archive'}</button>
          {!reward.archived && <><button className="edit-button" onClick={() => action((state) => selectGoal(state, progress.selectedRewardId === reward.id ? null : reward.id), 'Goal updated.')}>{progress.selectedRewardId === reward.id ? 'Clear goal' : 'Set as goal'}</button><button className="complete-button" disabled={progress.balance < reward.cost} aria-label={`Redeem ${reward.name} for ${reward.cost} stars`} onClick={(event) => { redeemButton.current = event.currentTarget; setConfirmation({ id: crypto.randomUUID(), rewardId: reward.id, name: reward.name, cost: reward.cost, balance: progress.balance }) }}>Redeem</button></>}
          </div>{!reward.archived && progress.balance < reward.cost && <p>{reward.cost - progress.balance} more stars needed</p>}
        </div></li>)}</ul>
      </section>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}<p className="announcement" role="status">{message}</p>
    <section className="history" aria-labelledby="redemption-history-title"><h3 id="redemption-history-title">Redemption history</h3>{!progress.redemptions.length ? <p className="section-description">Redeemed rewards will appear here.</p> : <ul>{[...progress.redemptions].reverse().map((event) => <li key={event.id}><div><strong>{event.name}</strong><p>{event.cost} stars · <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time></p></div></li>)}</ul>}</section>
    {confirmation && <Confirmation confirmation={confirmation} onCancel={closeConfirmation} onConfirm={() => {
      onChange((state) => redeemReward(state, confirmation))
      setMessage(`${confirmation.name} redeemed for ${confirmation.cost} stars.`)
      setError(''); closeConfirmation()
    }} />}
  </section>
}
