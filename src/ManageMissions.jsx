import { useEffect, useRef, useState } from 'react'
import { emojiOptions, suggestions, saveMission, archiveMission } from './progress'

const blank = { name: '', emoji: '⭐', stars: '', frequency: 'once_daily' }

export default function ManageMissions({ missions, onChange, onClose }) {
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [emojiSearch, setEmojiSearch] = useState('')
  const visibleEmojis = emojiOptions.filter(([emoji, label]) => `${emoji} ${label}`.toLowerCase().includes(emojiSearch.trim().toLowerCase()))
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])

  function field(key, value) { setDraft({ ...draft, [key]: value }); setError('') }
  function edit(mission) {
    setEditingId(mission.id)
    setDraft(mission)
    setEmojiSearch('')
    setError('')
    document.getElementById('mission-name').focus()
  }
  function submit(event) {
    event.preventDefault()
    try {
      const mission = { ...draft, stars: Number(draft.stars) }
      const id = editingId || crypto.randomUUID()
      onChange((state) => saveMission(state, mission, id))
      setMessage(editingId ? 'Mission updated. Previously earned stars stay the same.' : 'Mission added to Today.')
      setDraft(blank); setEditingId(null); setError('')
      document.getElementById('mission-name').focus()
    } catch (problem) { setError(problem.message) }
  }

  return <section className="mission-manager" aria-labelledby="manage-title">
    <div className="section-heading"><div><p className="eyebrow">FOR PARENTS</p><h2 id="manage-title" tabIndex={-1} ref={heading}>Manage missions</h2></div><button className="edit-button" onClick={onClose}>Back to Today</button></div>
    <p className="section-description">Choose the little things that work for your family.</p>
    <div className="manager-grid">
      <form className="settings-form mission-editor" onSubmit={submit}>
        <h3>{editingId ? 'Edit mission' : 'Create a mission'}</h3>
        {!editingId && <fieldset className="suggestions"><legend>Optional ideas — choose one to fill the form</legend>{suggestions.map((suggestion) => <button type="button" className="suggestion-button" key={suggestion.id} onClick={() => { setDraft({ ...suggestion, frequency: 'once_daily' }); setError('') }}>{suggestion.name}</button>)}</fieldset>}
        <label htmlFor="mission-name">Mission name</label>
        <input id="mission-name" value={draft.name} onChange={(event) => field('name', event.target.value)} required maxLength={120} />
        <fieldset className="emoji-picker">
          <legend>Choose an emoji</legend>
          <p className="field-hint emoji-selection" role="status">Selected: <span aria-hidden="true">{draft.emoji} </span>{emojiOptions.find(([emoji]) => emoji === draft.emoji)?.[1]}</p>
          <label htmlFor="emoji-search">Find an icon</label>
          <input id="emoji-search" type="search" placeholder="Search icons, e.g. laundry" value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} />
          <div className="emoji-options">{visibleEmojis.map(([emoji, label]) => <button type="button" key={emoji} aria-label={label} aria-pressed={draft.emoji === emoji} onClick={() => field('emoji', emoji)}><span className="emoji-symbol" aria-hidden="true">{emoji}</span><span className="emoji-label">{label}</span>{draft.emoji === emoji && <span className="emoji-check" aria-hidden="true">✓</span>}</button>)}</div>
          {!visibleEmojis.length && <p className="field-hint" role="status">No matching icons. Try another search.</p>}
          <p className="field-hint">Icon only — you choose the mission name, stars, and frequency.</p>
        </fieldset>
        <label htmlFor="mission-stars">Stars earned each time</label>
        <input id="mission-stars" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" required value={draft.stars} onChange={(event) => field('stars', event.target.value)} />
        <label htmlFor="mission-frequency">How often?</label>
        <select id="mission-frequency" value={draft.frequency} onChange={(event) => field('frequency', event.target.value)}><option value="once_daily">Once daily</option><option value="repeatable">Repeatable</option></select>
        <p className="field-hint">Repeatable missions earn stars every time they’re completed.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="submit" className="complete-button">{editingId ? 'Save changes' : 'Add mission'}</button>{editingId && <button type="button" className="edit-button" onClick={() => { setEditingId(null); setDraft(blank); setError('') }}>Cancel edit</button>}</div>
        <p role="status" className="field-hint">{message}</p>
      </form>
      <section className="mission-library" aria-labelledby="saved-missions-title"><h3 id="saved-missions-title">Your missions</h3><p className="section-description">Archiving hides a mission from Today. Stars and history stay.</p>
        {!missions.length && <p className="empty-missions">No missions yet. Create your first one, or start with an optional idea.</p>}
        <ul className="chore-list">{missions.map((mission) => <li className="chore-card managed-mission" key={mission.id}><span className="chore-icon" aria-hidden="true">{mission.emoji}</span><div className="chore-detail"><h4>{mission.name}</h4><p>{mission.stars} {mission.stars === 1 ? 'star' : 'stars'} · {mission.frequency === 'once_daily' ? 'Once daily' : 'Repeatable'}{mission.archived && ' · Archived'}</p><div className="form-actions"><button className="edit-button" aria-label={`Edit ${mission.name}`} onClick={() => edit(mission)}>Edit</button><button className="edit-button" aria-label={`${mission.archived ? 'Restore' : 'Archive'} ${mission.name}`} onClick={() => { try { onChange((state) => archiveMission(state, mission.id, !mission.archived)); setMessage(`${mission.name} ${mission.archived ? 'restored' : 'archived'}.`) } catch (problem) { setError(problem.message) } }}>{mission.archived ? 'Restore' : 'Archive'}</button></div></div></li>)}</ul>
      </section>
    </div>
  </section>
}
