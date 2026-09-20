import { createClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

function inspectUrl(value) {
  if (!value) return { valid: false, normalizedUrl: null }
  try {
    const parsed = new URL(value)
    const isSupabaseHost = parsed.hostname.endsWith('.supabase.co')
    const hasOnlyRootPath = parsed.pathname === '' || parsed.pathname === '/'
    const hasNoExtraParts = !parsed.search && !parsed.hash && !parsed.username && !parsed.password
    const valid = parsed.protocol === 'https:' && isSupabaseHost && hasOnlyRootPath && hasNoExtraParts
    return { valid, normalizedUrl: valid ? parsed.origin : null }
  } catch {
    return { valid: false, normalizedUrl: null }
  }
}

const url = inspectUrl(configuredUrl)

export const supabaseConfig = {
  urlPresent: Boolean(configuredUrl),
  publishableKeyPresent: Boolean(publishableKey),
  urlIsValidSupabaseBase: url.valid,
}

export const supabase = url.valid && publishableKey
  ? createClient(url.normalizedUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null

export const supabaseSetupMessage = !supabaseConfig.urlPresent || !supabaseConfig.publishableKeyPresent
  ? 'Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart Vite.'
  : 'Supabase URL configuration is invalid. Use only https://your-project-ref.supabase.co with no /rest/v1, /auth/v1, path, query, fragment, or credentials, then restart Vite.'
