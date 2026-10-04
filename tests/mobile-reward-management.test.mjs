import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const source = await readFile(new URL('../mobile/App.js', import.meta.url), 'utf8')
const rewardIconMigration = await readFile(new URL('../supabase/migrations/20261003000300_reward_icon_keys.sql', import.meta.url), 'utf8')
const require = createRequire(new URL('../mobile/package.json', import.meta.url))
const babel = require('@babel/core')
const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } })

function helper(name, dependencies = {}) {
  const needed = name === 'rewardPresentation' ? ['rewardPresentation'] : [name]
  const body = ast.program.body.filter((item) => item.type === 'FunctionDeclaration' && needed.includes(item.id.name))
  assert.ok(body.length, name + ' exists')
  const { code } = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'script', body } }, '', { configFile: false, babelrc: false })
  return new Function(...Object.keys(dependencies), code + '\nreturn ' + name)(...Object.values(dependencies))
}

test('reward draft validation trims names and accepts only safe positive whole-number costs', () => {
  const normalizeRewardDraft = helper('normalizeRewardDraft')
  assert.deepEqual(normalizeRewardDraft('  Movie night  ', '25'), { name: 'Movie night', starCost: 25 })
  for (const cost of ['', '0', '-1', '1.5', '10001', 'words']) assert.throws(() => normalizeRewardDraft('Treat', cost))
  assert.throws(() => normalizeRewardDraft('   ', '10'))
})

test('reward icon keys are constrained, persisted, and loaded without storing assets or URLs', () => {
  assert.match(rewardIconMigration, /add column if not exists icon_key text not null default 'gift'/)
  assert.match(rewardIconMigration, /rewards_icon_key_known/)
  assert.match(rewardIconMigration, /'chocolate', 'park', 'toy', 'trophy'/)
  assert.match(rewardIconMigration, /grant insert \(family_id, name, star_cost, icon_key\)/)
  assert.match(rewardIconMigration, /grant update \(name, star_cost, icon_key, archived_at\)/)
  assert.doesNotMatch(rewardIconMigration, /https?:\/\/|file:|base64/i)
  assert.ok(source.includes("select('id, name, star_cost, icon_key, archived_at')"))
  assert.ok(source.includes("from('rewards').insert({ family_id: familyId, name: normalized.name, star_cost: normalized.starCost, icon_key: iconKey })"))
  assert.ok(source.includes("from('rewards').update({ name: normalized.name, star_cost: normalized.starCost, icon_key: iconKey }).eq('id', reward.id)"))
})

test('mobile rewards use configured database rows, retain history through archive, and never create a reward while redeeming', () => {
  assert.match(source, /function ManageRewardsSheet/)
  assert.ok(source.includes('update({ archived_at: archived ? new Date().toISOString() : null })'))
  assert.ok(source.includes('const activeRewards = (rewards || []).filter((reward) => !reward.archived_at).map(rewardDisplay)'))
  const redemption = source.slice(source.indexOf('async function confirmRedemption'), source.indexOf('  const balanceRef'))
  assert.doesNotMatch(redemption, /from\('rewards'\)\.insert/)
  assert.match(redemption, /p_reward_id: reward\.id/)
})

test('reward presentation respects a selected icon and falls back safely', () => {
  const rewardPresentation = helper('rewardPresentation', { rewardIcons: { gift: '🎁', toy: '🧸' } })
  assert.equal(rewardPresentation({ name: 'Custom reward', icon_key: 'toy' }).emoji, '🧸')
  assert.equal(rewardPresentation({ name: 'Read a book', icon_key: 'unknown' }).emoji, '🎁')
})