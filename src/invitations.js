const tokenPattern = /^[A-Za-z0-9_-]{43}$/

export function isOwnerRole(role) {
  return role === 'owner'
}

export function inviteTokenFromSearch(search) {
  const token = new URLSearchParams(search).get('invite')
  return token && tokenPattern.test(token) ? token : null
}

export function invitationLink(origin, pathname, token) {
  if (!tokenPattern.test(token)) throw new Error('The invitation link could not be created.')
  return new URL(pathname + '?invite=' + encodeURIComponent(token), origin).toString()
}

const storageKey = 'our-little-star-pending-invite'

export function savePendingInvite(token) {
  if (tokenPattern.test(token)) sessionStorage.setItem(storageKey, token)
}

export function readPendingInvite() {
  const token = sessionStorage.getItem(storageKey)
  return token && tokenPattern.test(token) ? token : null
}

export function clearPendingInvite() {
  sessionStorage.removeItem(storageKey)
}
