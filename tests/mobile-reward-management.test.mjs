import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const source = await readFile(new URL('../mobile/App.js', import.meta.url), 'utf8')
const require = createRequire(new URL('../mobile/package.json', import.meta.url))
const babel = require('@babel/core')
const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } })

function helper(name) {
  const node = ast.program.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, name + ' exists')
  const { code } = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'script', body: [node] } }, '', { configFile: false, babelrc: false })
  return new Function(code + '\nreturn ' + name)()
}

test('reward draft validation trims names and accepts only safe positive whole-number costs', () => {
  const normalizeRewardDraft = helper('normalizeRewardDraft')
  assert.deepEqual(normalizeRewardDraft('  Movie night  ', '25'), { name: 'Movie night', starCost: 25 })
  for (const cost of ['', '0', '-1', '1.5', '10001', 'words']) assert.throws(() => normalizeRewardDraft('Treat', cost))
  assert.throws(() => normalizeRewardDraft('   ', '10'))
})

test('mobile rewards use configured database rows, retain history through archive, and never create a reward while redeeming', () => {
  assert.match(source, /function ManageRewardsSheet/)
  assert.ok(source.includes("from('rewards').insert({ family_id: familyId, name: normalized.name, star_cost: normalized.starCost })"))
  assert.ok(source.includes("from('rewards').update({ name: normalized.name, star_cost: normalized.starCost }).eq('id', reward.id)"))
  assert.ok(source.includes('update({ archived_at: archived ? new Date().toISOString() : null })'))
  assert.ok(source.includes('const activeRewards = (rewards || []).filter((reward) => !reward.archived_at).map(rewardDisplay)'))
  const redemption = source.slice(source.indexOf('async function confirmRedemption'), source.indexOf('  const balanceRef'))
  assert.doesNotMatch(redemption, /from\('rewards'\)\.insert/)
  assert.match(redemption, /p_reward_id: reward\.id/)
})

test('reward presentation falls back safely for a custom reward', () => {
  const rewardPresentation = helper('rewardPresentation')
  assert.deepEqual(rewardPresentation('Read a book'), { emoji: '🎁', description: 'A special reward to look forward to' })
})