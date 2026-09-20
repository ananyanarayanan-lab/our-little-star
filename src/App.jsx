import { useEffect, useRef, useState } from 'react'
import { readProgress, refreshDay, awardMission, undoCompletion, todayCompletions, storageKey } from './progress'
import './App.css'
import NameSetting from './NameSetting'
import RewardSetting from './RewardSetting'
import ManageMissions from './ManageMissions'
import ManageRewards from './ManageRewards'
import { readName } from './settings'
import AuthScreen from './AuthScreen'
import { supabase, supabaseConfig, supabaseSetupMessage } from './supabase'
import SharedFamilyData from './SharedFamilyData'

function App() {
  const [auth, setAuth] = useState(() => ({ loading: Boolean(supabase), session: null }))
  const [childName, setChildName] = useState(readName)
  const [initial] = useState(() => {
    try { return { progress: readProgress(), error: '' } }
    catch (error) { return { progress: null, error: error.message } }
  })
  const [progress, setProgress] = useState(initial.progress)
  const current = useRef(initial.progress)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(initial.error)
  const [managing, setManaging] = useState(false)
  const manageButton = useRef(null)
  const rewardsButton = useRef(null)

  useEffect(() => {
    if (!supabase) {
      return undefined
    }
    let alive = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return
      setAuth({ loading: false, session: sessionError ? null : data.session })
      if (sessionError) setError(sessionError.message)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setAuth({ loading: false, session })
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const checkDay = () => {
      if (!current.current) return
      const next = refreshDay(current.current)
      current.current = next
      setProgress(next)
    }
    const timer = window.setInterval(checkDay, 1000)
    window.addEventListener('focus', checkDay)
    document.addEventListener('visibilitychange', checkDay)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', checkDay)
      document.removeEventListener('visibilitychange', checkDay)
    }
  }, [])

  // Save the whole mission state together. Failed writes leave the previous state intact.
  function changeProgress(update) {
    const next = update(refreshDay(current.current))
    try { localStorage.setItem(storageKey, JSON.stringify(next)) }
    catch { throw new Error('Your browser couldn’t save this change. Allow local storage or free some space, then try again.') }
    current.current = next
    setProgress(next)
    setError('')
  }
  function complete(mission) {
    try { changeProgress((state) => awardMission(state, mission.id)); setMessage(`${mission.name} completed. Great job!`) }
    catch (problem) { setError(problem.message) }
  }
  function undo(event) {
    try { changeProgress((state) => undoCompletion(state, event.id)); setMessage(`${event.name} undone. ${event.stars} ${event.stars === 1 ? 'star' : 'stars'} removed.`) }
    catch (problem) { setError(problem.message) }
  }

  const missions = progress?.missions.filter((mission) => !mission.archived) || []
  const eventsToday = progress?.completions.filter((event) => event.day === progress.day && !event.undone) || []
  const dateLabel = progress && new Date(`${progress.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  if (auth.loading) return <main className="auth-shell"><p className="auth-loading" role="status">Checking your sign-in…</p></main>
  if (supabase && !auth.session) return <AuthScreen client={supabase} />
  if (supabase) return <main className="app-shell"><SharedFamilyData client={supabase} user={auth.session.user} onSignOut={() => supabase.auth.signOut()} /></main>

  return <main className="app-shell">
    <section className="local-only-banner" role="status"><strong>Local-only development mode</strong><p>{supabaseSetupMessage}</p><ul className="config-status" aria-label="Supabase configuration status"><li>Project URL: {supabaseConfig.urlPresent ? 'present' : 'missing'}</li><li>Publishable key: {supabaseConfig.publishableKeyPresent ? 'present' : 'missing'}</li><li>URL is a valid Supabase base URL: {supabaseConfig.urlIsValidSupabaseBase ? 'yes' : 'no'}</li></ul></section>
    <p className="prototype-label">LOCAL PROTOTYPE — THIS BROWSER ONLY</p>
    <NameSetting name={childName} onSave={setChildName} />
    {childName && progress && <>
      <div hidden={managing}>
        <section className="today-heading" aria-labelledby="today-title">
          <p className="eyebrow">A LITTLE EFFORT, A LITTLE MAGIC</p>
          <div className="today-toolbar"><h2 id="today-title">Let’s shine today <span aria-hidden="true">☀</span></h2><div className="form-actions"><button className="manage-button" ref={manageButton} onClick={() => setManaging('missions')}>Manage missions</button><button className="manage-button" ref={rewardsButton} onClick={() => setManaging('rewards')}>Manage rewards</button></div></div>
          <p><time dateTime={progress.day}>{dateLabel}</time> · A fresh chance to do good things.</p>
        </section>
        <section className="balance-card" aria-labelledby="balance-title"><div><h2 id="balance-title">Your star jar</h2><p className="balance"><strong>{progress.balance}</strong> <span>{progress.balance === 1 ? 'star' : 'stars'} collected</span></p><p>Every little helping hand adds a little sparkle.</p></div><div className="star-art" aria-hidden="true"><span className="sparkle one">✦</span><span className="big-star">★</span><span className="sparkle two">✧</span></div></section>
        <div className="content-grid">
          <section aria-labelledby="missions-title">
            <div className="section-heading"><h2 id="missions-title">Today’s little missions</h2><span className="count-badge">{eventsToday.length} completed today</span></div>
            <p className="section-description">Small steps that make a big difference.</p>
            {!missions.length && <div className="empty-missions"><p>No missions for Today yet.</p><button className="complete-button" onClick={() => setManaging('missions')}>Choose your first mission</button></div>}
            <ul className="chore-list">{missions.map((mission) => {
              const events = todayCompletions(progress, mission.id)
              const done = mission.frequency === 'once_daily' && events.length > 0
              const latest = events.at(-1)
              return <li key={mission.id} className={`chore-card ${done ? 'is-done' : ''}`}>
                <span className="chore-icon" aria-hidden="true">{mission.emoji}</span>
                <div className="chore-detail"><h3>{mission.name}</h3><p>★ {mission.stars} {mission.stars === 1 ? 'star' : 'stars'} · {mission.frequency === 'once_daily' ? 'Once daily' : 'Repeatable'}</p>{events.length > 0 && <p>{events.length} completed today</p>}</div>
                <div className="chore-actions"><button className="complete-button" disabled={done} onClick={() => complete(mission)} aria-label={`Complete ${mission.name}`}>{done ? '✓ Done' : latest ? '+ Again!' : '+ I did it!'}</button>{latest && <button className="undo-button" onClick={() => undo(latest)} aria-label={`Undo latest ${mission.name}, ${latest.stars} stars`}>Parent undo</button>}</div>
              </li>
            })}</ul>
            <p className="daily-note">Daily missions reset each new day. Your stars stay with you.</p>
            {progress.completions.length > 0 && <details className="history"><summary>Completion history & parent undo</summary><ul>{[...progress.completions].reverse().map((event) => <li key={event.id}><div><strong><span aria-hidden="true">{event.emoji} </span>{event.name}</strong><p><time dateTime={event.day}>{event.day}</time> · {event.stars} {event.stars === 1 ? 'star' : 'stars'}{event.undone && ' · Undone'}</p></div>{!event.undone && <button className="undo-button" onClick={() => undo(event)} aria-label={`Undo ${event.name} from ${event.day}, ${event.stars} stars`}>Undo</button>}</li>)}</ul></details>}
          </section>
          <RewardSetting balance={progress.balance} reward={progress.rewards.find((reward) => reward.id === progress.selectedRewardId && !reward.archived)} onManage={() => setManaging('rewards')} />
        </div>
      </div>
      {managing === 'missions' && <ManageMissions missions={progress.missions} onChange={changeProgress} onClose={() => { setManaging(false); requestAnimationFrame(() => manageButton.current?.focus()) }} />}
      {managing === 'rewards' && <ManageRewards progress={progress} onChange={changeProgress} onClose={() => { setManaging(false); requestAnimationFrame(() => rewardsButton.current?.focus()) }} />}
      <p className="announcement" role="status">{message}</p>
    </>}
    {error && <p className="storage-warning" role="alert">{error}{!progress && ' Reload to retry. No saved data has been overwritten.'}</p>}
    <footer><span aria-hidden="true">♡</span> Growing good habits, one star at a time.<p>Progress is stored in this browser on this device.</p></footer>
  </main>
}
export default App
