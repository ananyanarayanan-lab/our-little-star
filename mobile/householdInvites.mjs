const inviteMessages = [
  [/expired/i, 'This invite has expired.'],
  [/already been used|already used|claimed/i, 'This invite has already been used.'],
  [/different email|email address does not match/i, 'This invite was sent to a different email address.'],
  [/already.*(?:part|member).*family|already belongs to this household/i, "You're already part of this family."],
  [/revoked/i, 'This invite is no longer available.'],
  [/invalid|malformed/i, 'This invite is not valid.'],
]

export function householdInviteError(problem, fallback = 'Something went wrong. Please try again.') {
  const details = [problem?.message, problem?.context?.error, problem?.details, problem?.hint]
    .filter(Boolean).join(' ')
  return inviteMessages.find(([pattern]) => pattern.test(details))?.[1] || fallback
}

export function householdInviteSendError(code) {
  if (code === 'duplicate_invite') return 'An invite is already waiting for this email address.'
  if (code === 'not_owner') return 'Only the family owner can send an invite.'
  if (code === 'invalid_email') return 'Enter a valid email address.'
  return 'The invitation could not be sent. Please try again.'
}
