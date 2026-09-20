import { useCallback, useEffect, useMemo, useState } from 'react'
import { emojiOptions } from './progress'
import { invitationIdFromSearch, invitationLink, isOwnerRole, isUuid } from './invitations'

const zones = [['America/New_York', 'Eastern Time — New York'], ['America/Chicago', 'Central Time — Chicago'], ['America/Denver', 'Mountain Time — Denver'], ['America/Los_Angeles', 'Pacific Time — Los Angeles'], ['America/Anchorage', 'Alaska Time — Anchorage'], ['Pacific/Honolulu', 'Hawaii Time — Honolulu'], ['Europe/London', 'United Kingdom — London'], ['Europe/Paris', 'Central Europe — Paris'], ['Asia/Tokyo', 'Japan — Tokyo'], ['Australia/Sydney', 'Australia — Sydney']]
const rewardIdeas = ['Movie night', 'Pick out a toy', 'Choose a bedtime story', 'Trip to the playground']
const unwrap = (result) => { if (result.error) throw new Error(result.error.message); return result.data }
const formatTime = (value) => new Date(value).toLocaleString()
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(label + ' must be a positive whole number.'); return number }
function detectedZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } }
function familyDay(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts()
  const part = (type) => parts.find((item) => item.type === type)?.value
  return part('year') + '-' + part('month') + '-' + part('day')
}

function Onboarding({ client, userId, onComplete }) {
  const detected = useMemo(() => detectedZone(), [])
  const options = useMemo(() => detected && !zones.some(([zone]) => zone === detected) ? [[detected, detected.replaceAll('_', ' ') + ' — detected on this device'], ...zones] : zones, [detected])
  const [form, setForm] = useState({ family: '', child: '', zone: detected, confirmed: false })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [requestId] = useState(() => { const key = 'our-little-star-family-request-' + userId; const old = sessionStorage.getItem(key); if (old) return old; const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id })
  async function submit(event) {
    event.preventDefault()
    if (!form.family.trim() || !form.child.trim() || !form.zone || !form.confirmed) { setError('Enter both names, choose a timezone, and confirm it.'); return }
    setBusy(true); setError('')
    try {
      const familyId = unwrap(await client.rpc('create_family', { p_name: form.family.trim(), p_time_zone: form.zone, p_request_id: requestId }))
      const children = unwrap(await client.from('children').select('id').eq('family_id', familyId).eq('name', form.child.trim()).limit(1))
      if (!children.length) unwrap(await client.from('children').insert({ family_id: familyId, name: form.child.trim() }).select('id').single())
      sessionStorage.removeItem('our-little-star-family-request-' + userId); onComplete()
    } catch (problem) { setError('Setup could not be completed: ' + problem.message) } finally { setBusy(false) }
  }
  return <section className="shared-panel onboarding-panel" aria-labelledby="family-setup-title"><p className="eyebrow">WELCOME</p><h2 id="family-setup-title">Set up your family</h2><p className="section-description">Set up your family’s stars, missions, and rewards.</p><form className="settings-form" onSubmit={submit}>
    <label htmlFor="family-name">Family name</label><input id="family-name" required maxLength="120" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
    <label htmlFor="shared-child-name">Child name</label><input id="shared-child-name" required maxLength="120" value={form.child} onChange={(e) => setForm({ ...form, child: e.target.value })} />
    <label htmlFor="family-time-zone">Family timezone</label><select id="family-time-zone" required value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value, confirmed: false })}><option value="">Choose a timezone</option>{options.map(([zone, label]) => <option value={zone} key={zone}>{label} ({zone})</option>)}</select>
    <label className="timezone-confirmation"><input type="checkbox" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} />I confirm this timezone for everyone in our family.</label><p className="field-hint">The saved IANA timezone controls daily mission limits across parents’ devices.</p>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="manage-button" disabled={busy}>{busy ? 'Creating family…' : 'Create family'}</button>
  </form></section>
}

function EmojiPicker({ value, onChange }) {
  const [search, setSearch] = useState('')
  const choices = emojiOptions.filter(([emoji, label]) => (emoji + ' ' + label).toLowerCase().includes(search.trim().toLowerCase()))
  return <fieldset className="emoji-picker"><legend>Choose an emoji</legend><label htmlFor="shared-emoji-search">Find an icon</label><input id="shared-emoji-search" type="search" placeholder="Search icons, e.g. laundry" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="emoji-options">{choices.map(([emoji, label]) => <button type="button" key={emoji} aria-label={label} aria-pressed={value === emoji} onClick={() => onChange(emoji)}><span className="emoji-symbol" aria-hidden="true">{emoji}</span><span className="emoji-label">{label}</span>{value === emoji && <span className="emoji-check" aria-hidden="true">✓</span>}</button>)}</div></fieldset>
}

function MissionManager({ data, mutate }) {
  const blank = { name: '', emoji: '⭐', stars: '', frequency: 'once_daily' }
  const [draft, setDraft] = useState(blank); const [editing, setEditing] = useState(null)
  async function save(event) {
    event.preventDefault(); const name = draft.name.trim(); if (!name) throw new Error('Enter a mission name.'); const stars = positive(draft.stars, 'Stars')
    const row = { name, emoji: draft.emoji, stars, frequency: draft.frequency }
    if (editing) await mutate('mission-' + editing, () => data.client.from('missions').update(row).eq('id', editing).then(unwrap), 'Mission updated. Past stars are unchanged.')
    else await mutate('mission-new', () => data.client.from('missions').insert({ ...row, family_id: data.family.id }).then(unwrap), 'Mission added to Today.')
    setDraft(blank); setEditing(null)
  }
  return <section className="shared-manager" aria-labelledby="missions-title"><p className="eyebrow">MISSIONS</p><h2 id="missions-title">Manage missions</h2><p className="section-description">Archived missions disappear from Today and stay in history.</p><div className="manager-grid"><form className="settings-form mission-editor" onSubmit={(e) => save(e).catch(data.setError)}><h3>{editing ? 'Edit mission' : 'Create a mission'}</h3>
    <label htmlFor="shared-mission-name">Mission name</label><input id="shared-mission-name" required maxLength="120" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><EmojiPicker value={draft.emoji} onChange={(emoji) => setDraft({ ...draft, emoji })} />
    <label htmlFor="shared-mission-stars">Stars earned each time</label><input id="shared-mission-stars" type="number" min="1" step="1" inputMode="numeric" required value={draft.stars} onChange={(e) => setDraft({ ...draft, stars: e.target.value })} /><label htmlFor="shared-mission-frequency">How often?</label><select id="shared-mission-frequency" value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}><option value="once_daily">Once daily</option><option value="repeatable">Repeatable</option></select><p className="field-hint">Repeatable missions can earn stars every time they are completed.</p><div className="form-actions"><button className="complete-button" disabled={data.pending}>{editing ? 'Save changes' : 'Add mission'}</button>{editing && <button type="button" className="edit-button" onClick={() => { setEditing(null); setDraft(blank) }}>Cancel</button>}</div></form>
    <div><h3>Your missions</h3>{!data.missions.length ? <p className="empty-missions">No missions yet.</p> : <ul className="chore-list">{data.missions.map((mission) => <li className="chore-card" key={mission.id}><span className="chore-icon" aria-hidden="true">{mission.emoji}</span><div className="chore-detail"><h4>{mission.name}</h4><p>{mission.stars} stars · {mission.frequency === 'once_daily' ? 'Once daily' : 'Repeatable'}{mission.archived_at && ' · Archived'}</p><div className="form-actions"><button className="edit-button" disabled={data.pending} onClick={() => { setEditing(mission.id); setDraft({ name: mission.name, emoji: mission.emoji, stars: String(mission.stars), frequency: mission.frequency }) }}>Edit</button><button className="edit-button" disabled={data.pending} onClick={() => mutate('archive-mission-' + mission.id, () => data.client.from('missions').update({ archived_at: mission.archived_at ? null : new Date().toISOString() }).eq('id', mission.id).then(unwrap), mission.archived_at ? 'Mission restored.' : 'Mission archived.')}>{mission.archived_at ? 'Restore' : 'Archive'}</button></div></div></li>)}</ul>}</div></div></section>
}

function RewardManager({ data, mutate, child, balance }) {
  const [draft, setDraft] = useState({ name: '', cost: '' }); const [editing, setEditing] = useState(null); const [confirmation, setConfirmation] = useState(null)
  async function save(event) {
    event.preventDefault(); const name = draft.name.trim(); if (!name) throw new Error('Enter a reward name.'); const star_cost = positive(draft.cost, 'Star cost')
    if (editing) await mutate('reward-' + editing, () => data.client.from('rewards').update({ name, star_cost }).eq('id', editing).then(unwrap), 'Reward updated. Past redemptions are unchanged.')
    else await mutate('reward-new', () => data.client.from('rewards').insert({ family_id: data.family.id, name, star_cost }).then(unwrap), 'Reward added.')
    setDraft({ name: '', cost: '' }); setEditing(null)
  }
  async function archive(reward) { await mutate('archive-reward-' + reward.id, async () => { unwrap(await data.client.from('rewards').update({ archived_at: reward.archived_at ? null : new Date().toISOString() }).eq('id', reward.id)); if (!reward.archived_at && child.selected_reward_id === reward.id) unwrap(await data.client.from('children').update({ selected_reward_id: null }).eq('id', child.id)) }, reward.archived_at ? 'Reward restored.' : 'Reward archived and the active goal cleared.') }
  const cards = <section className="reward-library" aria-labelledby="your-rewards-title"><h3 id="your-rewards-title">Your rewards</h3><p className="section-description">Available balance: <strong>{balance} stars</strong>.</p>{!data.rewards.length ? <p className="empty-missions">No rewards yet.</p> : <ul className="chore-list">{data.rewards.map((reward) => <li className={'chore-card reward-item ' + (child.selected_reward_id === reward.id && !reward.archived_at ? 'is-goal' : '')} key={reward.id}><div className="chore-detail"><h4>{reward.name}</h4><p>{reward.star_cost} stars{reward.archived_at ? ' · Archived' : child.selected_reward_id === reward.id ? ' · Selected goal' : ''}</p><div className="form-actions"><button className="edit-button" disabled={data.pending} onClick={() => { setEditing(reward.id); setDraft({ name: reward.name, cost: String(reward.star_cost) }) }}>Edit</button><button className="edit-button" disabled={data.pending} onClick={() => archive(reward)}>{reward.archived_at ? 'Restore' : 'Archive'}</button>{!reward.archived_at && <><button className="edit-button" disabled={data.pending} onClick={() => mutate('goal-' + reward.id, () => data.client.from('children').update({ selected_reward_id: child.selected_reward_id === reward.id ? null : reward.id }).eq('id', child.id).then(unwrap), child.selected_reward_id === reward.id ? 'Goal cleared.' : 'Goal selected.')}>{child.selected_reward_id === reward.id ? 'Clear goal' : 'Set as goal'}</button><button className="complete-button" disabled={data.pending || balance < reward.star_cost} onClick={() => setConfirmation(reward)}>Redeem</button></>}</div></div></li>)}</ul>}</section>
  const form = <form className="settings-form mission-editor" onSubmit={(e) => save(e).catch(data.setError)}><h3>{editing ? 'Edit reward' : 'Create a reward'}</h3>{!editing && <fieldset className="suggestions"><legend>Optional ideas</legend>{rewardIdeas.map((name) => <button type="button" className="suggestion-button" key={name} onClick={() => setDraft({ ...draft, name })}>{name}</button>)}</fieldset>}<label htmlFor="shared-reward-name">Reward name</label><input id="shared-reward-name" required maxLength="120" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><label htmlFor="shared-reward-cost">Star cost</label><input id="shared-reward-cost" type="number" min="1" step="1" inputMode="numeric" required value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /><div className="form-actions"><button className="complete-button" disabled={data.pending}>{editing ? 'Save changes' : 'Add reward'}</button>{editing && <button type="button" className="edit-button" onClick={() => { setEditing(null); setDraft({ name: '', cost: '' }) }}>Cancel</button>}</div></form>
  return <section className="shared-manager" aria-labelledby="rewards-title"><p className="eyebrow">REWARDS</p><h2 id="rewards-title">Rewards</h2>{cards}<section className="reward-editor"><h3>{editing ? 'Update this reward' : 'Add a reward'}</h3>{form}</section>
    {confirmation && <section className="confirmation-card" role="dialog" aria-modal="true" aria-labelledby="shared-redeem-title"><h4 id="shared-redeem-title">Redeem this reward?</h4><p><strong>{confirmation.name}</strong> costs {confirmation.star_cost} stars.</p><p>After redemption, {balance - confirmation.star_cost} stars will remain.</p><div className="form-actions"><button className="edit-button" disabled={data.pending} onClick={() => setConfirmation(null)}>Cancel</button><button className="complete-button" disabled={data.pending} onClick={() => mutate('redeem-' + confirmation.id, () => data.client.rpc('redeem_reward', { p_child_id: child.id, p_reward_id: confirmation.id, p_request_id: crypto.randomUUID() }).then(unwrap), confirmation.name + ' redeemed.', () => setConfirmation(null))}>Confirm redemption</button></div></section>}
  </section>
}

function Today({ data, mutate, child, balance, timeZone, onRewards }) {
  const active = data.missions.filter((mission) => !mission.archived_at); const events = data.completions.filter((event) => event.child_id === child.id); const goal = data.rewards.find((reward) => reward.id === child.selected_reward_id && !reward.archived_at)
  const today = familyDay(timeZone)
  return <><section className="today-heading"><p className="eyebrow">TODAY</p><h2>{child.name}’s Stars <span aria-hidden="true">✨</span></h2><p>A little effort, a little magic.</p></section><section className="balance-card"><div><h2>Your star jar</h2><p className="balance"><strong>{balance}</strong><span>{balance === 1 ? 'star' : 'stars'} collected</span></p><p>Every little helping hand adds a little sparkle.</p></div><div className="star-art" aria-hidden="true"><span className="big-star">★</span></div></section><section className="today-stack"><section aria-labelledby="today-missions"><div className="section-heading"><h2 id="today-missions">Today’s little missions</h2></div>{!active.length ? <p className="empty-missions">No missions for Today yet.</p> : <ul className="chore-list">{active.map((mission) => { const completed = events.filter((event) => event.mission_id === mission.id && event.completed_on === today && !event.undone_at); const latest = completed[0]; const done = mission.frequency === 'once_daily' && completed.length > 0; return <li className={'chore-card ' + (done ? 'is-done' : '')} key={mission.id}><span className="chore-icon" aria-hidden="true">{mission.emoji}</span><div className="chore-detail"><h3>{mission.name}</h3><p>★ {mission.stars} stars · {mission.frequency === 'once_daily' ? 'Once daily' : 'Repeatable'}</p>{completed.length > 0 && <p>{completed.length} completed today</p>}</div><div className="chore-actions"><button className="complete-button" disabled={data.pending || done} onClick={() => mutate('award-' + mission.id, () => data.client.rpc('award_mission', { p_child_id: child.id, p_mission_id: mission.id, p_request_id: crypto.randomUUID() }).then(unwrap), mission.name + ' completed.', undefined, true)}>{done ? '✓ Done' : completed.length ? '+ Again!' : '+ I did it!'}</button>{latest && <button className="undo-button" disabled={data.pending} onClick={() => mutate('undo-' + latest.id, () => data.client.rpc('undo_completion', { p_completion_id: latest.id, p_request_id: crypto.randomUUID() }).then(unwrap), mission.name + ' undone.', undefined, true)}>Parent undo</button>}</div></li> })}</ul>}<p className="daily-note">Daily missions reset using your family timezone.</p></section><section className="reward-card"><p className="eyebrow">REWARD GOAL</p><div className="reward-art" aria-hidden="true">🎁</div><h2>{goal?.name || 'Pick a reward'}</h2>{goal ? <><p>{goal.star_cost} stars needed</p><div className="progress-label"><span>Progress</span><span>{Math.min(balance, goal.star_cost)} of {goal.star_cost}</span></div><progress value={Math.min(balance, goal.star_cost)} max={goal.star_cost} /></> : <><p>Add a goal your little star can look forward to.</p><button className="complete-button" onClick={onRewards}>Go to Rewards</button></>}</section></section></>
}

function copyText(value) {
  if (!navigator.clipboard?.writeText) throw new Error('Copy is unavailable in this browser. Select and copy the text instead.')
  return navigator.clipboard.writeText(value)
}

function InviteParent({ client, familyId }) {
  const [parentId, setParentId] = useState(''); const [link, setLink] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  async function invite(event) {
    event.preventDefault(); const id = parentId.trim()
    if (!isUuid(id)) { setError('Enter the other parent’s Parent ID: a full UUID.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const invitationId = unwrap(await client.rpc('invite_parent', { p_family_id: familyId, p_parent_id: id }))
      setLink(invitationLink(window.location.origin, window.location.pathname, invitationId))
      setMessage('Invitation link created.')
    } catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  return <article className="settings-card"><h3>Invite another parent</h3><p>Ask the other parent for their Parent ID. They must have their own signed-in account.</p><form className="settings-form" onSubmit={invite}><label htmlFor="invited-parent-id">Other parent’s Parent ID</label><input id="invited-parent-id" value={parentId} onChange={(event) => setParentId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" /><button className="complete-button" disabled={busy}>{busy ? 'Creating link…' : 'Create invitation link'}</button></form>{error && <p className="form-error" role="alert">{error}</p>}{link && <div className="invitation-link"><label htmlFor="invitation-link">Invitation link</label><input id="invitation-link" value={link} readOnly /><button className="edit-button" onClick={() => copyText(link).then(() => setMessage('Invitation link copied.')).catch((problem) => setError(problem.message))}>Copy link</button><p className="field-hint">Create the link from the deployed Pages site, not localhost. The invited parent signs into their own account first, then opens it.</p></div>}{message && <p className="announcement" role="status">{message}</p>}</article>
}

function Settings({ family, user, membership, client, onSignOut }) {
  const [copyMessage, setCopyMessage] = useState('')
  return <section className="settings-page"><p className="eyebrow">SETTINGS</p><h2>Family settings</h2><article className="settings-card"><h3>{family.name}</h3><p><strong>Timezone:</strong> {family.time_zone}</p><p className="field-hint">Timezone changes are planned for a later update.</p></article><article className="settings-card"><h3>Signed-in parent</h3><p>{user.email}</p><p><strong>Parent ID:</strong></p><input className="parent-id" value={user.id} readOnly aria-label="Your Parent ID" /><button className="edit-button" onClick={() => copyText(user.id).then(() => setCopyMessage('Parent ID copied.')).catch((problem) => setCopyMessage(problem.message))}>Copy Parent ID</button><p className="field-hint">Share this ID only with your family owner so they can invite you.</p>{copyMessage && <p className="announcement" role="status">{copyMessage}</p>}<p className="sync-indicator">● Connected</p><button className="edit-button" onClick={onSignOut}>Sign out</button></article>{isOwnerRole(membership.role) && <InviteParent client={client} familyId={family.id} />}</section>
}

function InvitationAcceptance({ client, invitationId, onAccepted, onDismiss }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  if (!isUuid(invitationId)) return <section className="shared-panel onboarding-panel" role="alert"><p className="eyebrow">FAMILY INVITATION</p><h2>This invitation link is invalid.</h2><p className="section-description">Ask the family owner for a new invitation link.</p><button className="edit-button" onClick={onDismiss}>Continue</button></section>
  async function accept() {
    setBusy(true); setError('')
    try { unwrap(await client.rpc('accept_parent_invitation', { p_invitation_id: invitationId })); onAccepted() }
    catch (problem) {
      const message = problem.message || 'Invitation unavailable.'
      setError(/expired/i.test(message) ? 'This invitation has expired.' : /unavailable|denied|permission/i.test(message) ? 'This invitation is invalid or belongs to a different parent.' : message)
    } finally { setBusy(false) }
  }
  return <section className="shared-panel onboarding-panel" aria-labelledby="accept-invitation-title"><p className="eyebrow">FAMILY INVITATION</p><h2 id="accept-invitation-title">Join this family?</h2><p className="section-description">You are signed in. Accepting adds this account as a parent in the invited family.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="edit-button" disabled={busy} onClick={onDismiss}>Not now</button><button className="manage-button" disabled={busy} onClick={accept}>{busy ? 'Joining…' : 'Accept invitation'}</button></div></section>
}

function FamilyPicker({ client, memberships, onChoose }) {
  const [families, setFamilies] = useState([]); const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all(memberships.map(async (membership) => {
      const response = await client.from('families').select('id, name').eq('id', membership.family_id).single()
      return { ...membership, family: unwrap(response) }
    })).then((items) => { if (active) setFamilies(items) }).catch((problem) => { if (active) setError('Your families could not be loaded: ' + problem.message) })
    return () => { active = false }
  }, [client, memberships])
  return <section className="shared-panel onboarding-panel" aria-labelledby="family-picker-title"><p className="eyebrow">OUR LITTLE STAR</p><h2 id="family-picker-title">Choose a family</h2><p className="section-description">This account belongs to more than one family. Choose the one you want to use now.</p>{error && <p className="form-error" role="alert">{error}</p>}{!families.length && !error ? <p role="status">Loading families…</p> : <div className="family-picker-list">{families.map((membership) => <button className="settings-card family-choice" key={membership.family_id} onClick={() => onChoose(membership.family_id)}><strong>{membership.family.name}</strong><span>{membership.role === 'owner' ? 'Owner' : 'Parent'}</span></button>)}</div>}</section>
}
export default function SharedFamilyData({ client, user, onSignOut }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' }); const [notice, setNotice] = useState(''); const [a11yNotice, setA11yNotice] = useState(''); const [pending, setPending] = useState(false); const [online, setOnline] = useState(() => navigator.onLine); const [selectedChildId, setSelectedChildId] = useState(''); const [selectedFamilyId, setSelectedFamilyId] = useState(''); const [page, setPage] = useState('today'); const [invitationId, setInvitationId] = useState(() => invitationIdFromSearch(window.location.search) ?? new URLSearchParams(window.location.search).get('invite'))
  const load = useCallback(async (showLoading = true, requestedFamilyId = selectedFamilyId) => {
    if (showLoading) setState({ status: 'loading', data: null, error: '' })
    try {
      const memberships = unwrap(await client.from('family_memberships').select('family_id, role, joined_at').order('joined_at'))
      if (!memberships.length) { setState({ status: 'onboarding', data: null, error: '' }); return }
      if (memberships.length > 1 && !requestedFamilyId) { setState({ status: 'choose-family', data: { memberships }, error: '' }); return }
      const membership = memberships.find((item) => item.family_id === requestedFamilyId) || memberships[0]
      if (!membership) { setState({ status: 'error', data: null, error: 'The selected family is unavailable.' }); return }
      const id = membership.family_id
      const responses = await Promise.all([client.from('families').select('id, name, time_zone').eq('id', id).single(), client.from('children').select('id, name, selected_reward_id, archived_at').eq('family_id', id).order('created_at'), client.from('missions').select('id, name, emoji, stars, frequency, archived_at').eq('family_id', id).order('created_at'), client.from('rewards').select('id, name, star_cost, archived_at').eq('family_id', id).order('created_at'), client.from('mission_completions').select('id, child_id, mission_id, completed_at, completed_on, mission_name_snapshot, emoji_snapshot, stars_earned, undone_at').eq('family_id', id).order('completed_at', { ascending: false }), client.from('reward_redemptions').select('id, child_id, redeemed_at, reward_name_snapshot, stars_spent').eq('family_id', id).order('redeemed_at', { ascending: false }), client.from('child_star_balances').select('child_id, balance').eq('family_id', id)])
      setState({ status: 'ready', error: '', data: { client, membership, family: unwrap(responses[0]), children: unwrap(responses[1]), missions: unwrap(responses[2]), rewards: unwrap(responses[3]), completions: unwrap(responses[4]), redemptions: unwrap(responses[5]), balances: unwrap(responses[6]) } })
    } catch (problem) { setState({ status: 'error', data: null, error: 'Family data could not be loaded: ' + problem.message }) }
  }, [client, selectedFamilyId])
  useEffect(() => { const timer = window.setTimeout(() => { void load(false) }, 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
  async function mutate(key, action, success, after, announceOnly = false) { if (pending) return; if (!online) { setState((current) => ({ ...current, error: 'You appear to be offline. Reconnect and try again.' })); return } setPending(true); setNotice(''); setA11yNotice(''); try { await action(); await load(false); if (announceOnly) setA11yNotice(success); else setNotice(success); after?.() } catch (problem) { setState((current) => ({ ...current, error: problem.message })) } finally { setPending(false) } }
  function dismissInvitation() { window.history.replaceState({}, '', window.location.pathname); setInvitationId(null) }
  function invitationAccepted() { dismissInvitation(); setSelectedFamilyId(''); setPage('today'); void load() }
  if (invitationId) return <InvitationAcceptance client={client} invitationId={invitationId} onDismiss={dismissInvitation} onAccepted={invitationAccepted} />
  if (state.status === 'loading') return <section className="shared-panel" aria-live="polite"><p className="eyebrow">OUR LITTLE STAR</p><p>Loading your family…</p></section>
  if (state.status === 'onboarding') return <Onboarding client={client} userId={user.id} onComplete={load} />
  if (state.status === 'choose-family') return <FamilyPicker client={client} memberships={state.data.memberships} onChoose={(familyId) => { setSelectedFamilyId(familyId); void load(true, familyId) }} />
  if (state.status === 'error' && !state.data) return <section className="shared-panel" role="alert"><p className="eyebrow">OUR LITTLE STAR</p><p>{state.error}</p><button className="edit-button" onClick={() => load()}>Try again</button></section>
  const data = state.data; const children = data.children.filter((item) => !item.archived_at); const child = children.find((item) => item.id === selectedChildId) || children[0]; const balance = child ? Number(data.balances.find((item) => item.child_id === child.id)?.balance || 0) : 0; const view = { ...data, pending, setError: (problem) => setState((current) => ({ ...current, error: problem.message || String(problem) })) }
  const timeline = child ? [
    ...data.completions.filter((event) => event.child_id === child.id).map((event) => ({ ...event, type: 'mission', timestamp: event.undone_at || event.completed_at })),
    ...data.redemptions.filter((event) => event.child_id === child.id).map((event) => ({ ...event, type: 'redemption', timestamp: event.redeemed_at })),
  ].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp)) : []
  const history = child && <section className="history-page"><p className="eyebrow">HISTORY</p><h2>Family activity</h2>{!timeline.length ? <p className="empty-missions">No activity yet.</p> : <ul className="history">{timeline.map((event) => event.type === 'mission' ? <li key={'mission-' + event.id}><div><strong><span aria-hidden="true">{event.emoji_snapshot} </span>{event.mission_name_snapshot}</strong><p>{event.undone_at ? 'Mission undone' : event.stars_earned + ' stars earned'} · {formatTime(event.timestamp)}</p></div></li> : <li key={'redemption-' + event.id}><div><strong>{event.reward_name_snapshot}</strong><p>{event.stars_spent} stars spent · {formatTime(event.timestamp)}</p></div></li>)}</ul>}</section>
  const content = !child ? <p className="empty-missions">This family has no active child yet.</p> : page === 'today' ? <Today data={view} mutate={mutate} child={child} balance={balance} timeZone={data.family.time_zone} onRewards={() => setPage('rewards')} /> : page === 'missions' ? <MissionManager data={view} mutate={mutate} /> : page === 'rewards' ? <RewardManager data={view} mutate={mutate} child={child} balance={balance} /> : page === 'history' ? history : <Settings family={data.family} membership={data.membership} user={user} client={client} onSignOut={onSignOut} />
  const nav = [['today', 'Today'], ['missions', 'Missions'], ['rewards', 'Rewards'], ['history', 'History'], ['settings', 'Settings']]
  return <section className="family-app" aria-labelledby="family-app-title"><header className="family-header"><div className="brand"><span className="brand-star" aria-hidden="true">★</span><div><h1 id="family-app-title">Our Little Star</h1><p className="brand-subtitle">{data.family.name}</p></div></div><button className="edit-button" disabled={pending} onClick={() => load()}>Refresh</button></header><nav className="family-nav" aria-label="Family app">{nav.map(([id, label]) => <button key={id} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav>{children.length > 1 && <div className="shared-child-select"><label htmlFor="shared-child-select">Viewing stars for</label><select id="shared-child-select" value={child?.id || ''} onChange={(event) => setSelectedChildId(event.target.value)}>{children.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>}{!online && <p className="storage-warning" role="status">You’re offline. Reconnect before making changes.</p>}{state.error && <p className="form-error" role="alert">{state.error}</p>}{notice && <p className="announcement" role="status">{notice}</p>}<p className="sr-only" aria-live="polite">{a11yNotice}</p><main className="family-content">{content}</main></section>
}
