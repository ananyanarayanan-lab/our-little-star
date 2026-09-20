const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function isOwnerRole(role) {
  return role === 'owner'
}

export function invitationIdFromSearch(search) {
  const value = new URLSearchParams(search).get('invite')
  return isUuid(value) ? value : null
}

export function invitationLink(origin, pathname, invitationId) {
  if (!isUuid(invitationId)) throw new Error('Invitation ID must be a UUID.')
  return new URL(pathname + '?invite=' + invitationId, origin).toString()
}
