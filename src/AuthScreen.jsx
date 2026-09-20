import { useState } from 'react'

const initialForm = { email: '', password: '' }

function readableAuthError(error) {
  if (error.message === 'Invalid login credentials') {
    return 'That email and password do not match a confirmed account in this Supabase project. Choose Sign up if this is a new account, or confirm the sign-up email before signing in.'
  }
  return error.message
}

export default function AuthScreen({ client }) {
  const [mode, setMode] = useState('sign-in')
  const [form, setForm] = useState(initialForm)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const email = form.email.trim()
    try {
      const result = mode === 'sign-up'
        ? await client.auth.signUp({ email, password: form.password })
        : await client.auth.signInWithPassword({ email, password: form.password })
      if (result.error) {
        setError(readableAuthError(result.error))
        return
      }
      if (mode === 'sign-up') {
        setMessage(result.data.session
          ? 'Your account is ready. You are signed in.'
          : 'Check your email to confirm your account, then sign in.')
        setForm(initialForm)
      }
    } catch {
      setError('Could not reach Supabase. Check your connection and project settings, then try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-card" aria-labelledby="auth-title">
      <span className="brand-star" aria-hidden="true">★</span>
      <p className="eyebrow">PARENT AREA</p>
      <h1 id="auth-title">Our Little Star</h1>
      <p className="auth-intro">Sign in to open your family’s local prototype.</p>
      <div className="auth-tabs" role="tablist" aria-label="Account action">
        <button type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => switchMode('sign-in')}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => switchMode('sign-up')}>Sign up</button>
      </div>
      <form className="settings-form auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength="6" />
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="auth-success" role="status">{message}</p>}
        <button className="manage-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</button>
      </form>
      <p className="field-hint">Family data still stays in this browser for now. Database syncing comes next.</p>
    </section>
  </main>
}
