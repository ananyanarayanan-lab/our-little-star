import { useRef, useState } from 'react'
import { nameKey } from './settings'

function focusName(input) {
  input?.focus()
}

export default function NameSetting({ name, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState('')
  const heading = useRef(null)

  function saveName(event) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Please enter a name.')
      return
    }
    try {
      // This key is separate from both chore progress and reward settings.
      localStorage.setItem(nameKey, trimmed)
      onSave(trimmed)
      setEditing(false)
      setError('')
      heading.current?.focus()
    } catch {
      setError('Your browser couldn’t save the name. Allow local storage and try again.')
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-star" aria-hidden="true">★</span>
          <div className="brand-text"><h1 ref={heading} tabIndex={-1}>{name ? `${name}’s Stars` : 'Our Little Star'}</h1>
            {name && <p className="brand-subtitle">Our little star ✨</p>}
          </div>
        </div>
        {name && <button className="edit-button" onClick={() => { setDraft(name); setError(''); setEditing(true) }}>Edit name</button>}
      </header>
      {(!name || editing) && (
        <section className="name-card" aria-labelledby="name-title">
          <h2 id="name-title">{name ? 'Edit your little star’s name' : 'What’s your little star’s name?'}</h2>
          <form className="settings-form" onSubmit={saveName}>
            <label htmlFor="child-name">Name</label>
            <input id="child-name" value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} required autoComplete="off" ref={focusName} aria-invalid={!!error} aria-describedby={error ? 'name-error' : undefined} />
            {error && <p id="name-error" className="form-error" role="alert">{error}</p>}
            <div className="form-actions">
              <button className="complete-button" type="submit">{name ? 'Save name' : 'Let’s go'}</button>
              {name && <button className="edit-button" type="button" onClick={() => { setEditing(false); heading.current?.focus() }}>Cancel</button>}
            </div>
          </form>
        </section>
      )}
    </>
  )
}
