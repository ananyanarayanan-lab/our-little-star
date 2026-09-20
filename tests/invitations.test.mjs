import test from 'node:test'
import assert from 'node:assert/strict'
import { invitationIdFromSearch, invitationLink, isOwnerRole, isUuid } from '../src/invitations.js'

const invitationId = 'e5c2d4a1-8c0f-4f25-9bf2-1da69d6cf7f5'

test('invitation links contain only a valid invitation ID', () => {
  const link = invitationLink('https://example.test', '/family', invitationId)
  assert.equal(link, 'https://example.test/family?invite=' + invitationId)
  assert.equal(invitationIdFromSearch(new URL(link).search), invitationId)
  assert.throws(() => invitationLink('https://example.test', '/', 'not-an-id'))
})

test('invalid invitation query values are rejected', () => {
  assert.equal(isUuid(invitationId), true)
  assert.equal(invitationIdFromSearch('?invite=not-a-uuid'), null)
  assert.equal(invitationIdFromSearch('?other=value'), null)
})

test('owner visibility is determined only by the membership role returned by Supabase', () => {
  assert.equal(isOwnerRole('owner'), true)
  assert.equal(isOwnerRole('parent'), false)
})
