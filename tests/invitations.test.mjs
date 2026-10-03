import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { invitationLink, inviteTokenFromSearch, isOwnerRole } from '../src/invitations.js'

const token = 'v3PLOHRFZwpbTGwuMMFh7PmhQ_CDiMcPmG5Vgw0qgGw'

test('opaque invitation links contain a token, never a household or parent identifier', () => {
  const link = invitationLink('https://example.test', '/our-little-star/', token)
  const parsed = new URL(link)
  assert.equal(parsed.pathname, '/our-little-star/')
  assert.equal(inviteTokenFromSearch(parsed.search), token)
  assert.equal(parsed.searchParams.get('family'), null)
  assert.throws(() => invitationLink('https://example.test', '/', 'not-a-secure-token'))
})

test('only a correctly shaped opaque invitation token is accepted from a link', () => {
  assert.equal(inviteTokenFromSearch('?invite=' + token), token)
  assert.equal(inviteTokenFromSearch('?invite=not-a-token'), null)
  assert.equal(inviteTokenFromSearch('?family=' + token), null)
})

test('owner visibility comes from the membership role returned by Supabase', () => {
  assert.equal(isOwnerRole('owner'), true)
  assert.equal(isOwnerRole('parent'), false)
})

test('source code contains no legacy invitation RPC calls', async () => {
  const source = await readFile(new URL('../src/SharedFamilyData.jsx', import.meta.url), 'utf8')
  assert.equal(source.includes('invite_parent'), false)
  assert.equal(source.includes('accept_parent_invitation'), false)
})
