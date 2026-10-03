import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/already been sent/i.test(message)) return 'duplicate_invite'
  if (/only the household owner/i.test(message)) return 'not_owner'
  if (/valid email|email address/i.test(message)) return 'invalid_email'
  return 'send_failed'
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Sign in before sending an invitation.')
    const { familyId, email } = await request.json()
    if (typeof familyId !== 'string' || typeof email !== 'string') throw new Error('Enter an email address.')
    const redirectBase = Deno.env.get('HOUSEHOLD_INVITE_REDIRECT_URL')
    if (!redirectBase) throw new Error('Household invite redirects have not been configured.')
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Sign in before sending an invitation.')
    const { data: invite, error: inviteError } = await userClient.rpc('create_household_invite', { p_family_id: familyId, p_email: email })
    if (inviteError) throw new Error(inviteError.message)
    const row = Array.isArray(invite) ? invite[0] : invite
    if (!row?.invite_token) throw new Error('The invitation could not be created.')
    const separator = redirectBase.includes('?') ? '&' : '?'
    const emailRedirectTo = `${redirectBase}${separator}invite=${encodeURIComponent(row.invite_token)}`
    const { error: emailError } = await userClient.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo } })
    if (emailError) {
      // Do not strand an active, unsent invitation that would block a retry.
      const { error: revokeError } = await userClient.rpc('revoke_household_invite', { p_invitation_id: row.invitation_id })
      if (revokeError) console.log('[send-household-invite] Could not revoke failed delivery:', revokeError.message)
      throw new Error(emailError.message)
    }
    return Response.json({ sent: true, expiresAt: row.expires_at }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.log('[send-household-invite] Handled invitation failure:', error instanceof Error ? error.message : error)
    return Response.json({ sent: false, errorCode: errorCode(error) }, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
