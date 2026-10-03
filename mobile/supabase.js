import 'expo-sqlite/localStorage/install'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()

export const configured = Boolean(url && key && /^https:\/\/[^/]+\.supabase\.co\/?$/.test(url))
export const setupMessage = 'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to mobile/.env, then restart Expo.'

export const supabase = configured
  ? createClient(url.replace(/\/$/, ''), key, {
    auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  })
  : null
