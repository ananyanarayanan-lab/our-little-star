import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260927000100_custom_missions.sql', import.meta.url)
const iconKeyOnlyMigration = new URL('../supabase/migrations/20260927000200_mission_icon_keys_only.sql', import.meta.url)
const mobile = new URL('../mobile/App.js', import.meta.url)

test('custom mission migration preserves the ledger and validates reusable mission fields', async () => {
  const source = await readFile(migration, 'utf8')
  assert.match(source, /add column if not exists icon_key text not null default 'star'/)
  assert.match(source, /missions_icon_key_known/)
  assert.match(source, /missions_cooldown_range check \(repeat_cooldown_seconds between 60 and 43200\)/)
  assert.match(source, /update public\.missions set frequency = 'repeatable'/)
  assert.doesNotMatch(source, /delete from public\.(missions|mission_completions|reward_redemptions)/i)
})

test('mobile custom missions use curated icon keys and per-mission cooldowns', async () => {
  const source = await readFile(mobile, 'utf8')
  assert.match(source, /import \{ missionIconOptions, missionIcon, missionVisualFields \}/)
  assert.match(source, /repeat_cooldown_seconds: cooldown/)
  assert.match(source, /\.\.\.missionVisualFields\(iconKey\)/)
  assert.match(source, /ManageMissionsSheet/)
  assert.match(source, /MissionEditorSheet/)
  assert.match(source, /const activeMissions = missions\.filter\(\(mission\) => !mission\.archived_at\)/)
})

test('invalid custom cooldowns cannot silently keep a previous valid value', async () => {
  const source = await readFile(mobile, 'utf8')
  assert.match(source, /setCooldown\(value\.trim\(\) \? seconds : NaN\)/)
  assert.match(source, /!Number\.isInteger\(cooldown\)/)
})

test('cooldown history is scoped to the active child and newest completion', async () => {
  const source = await readFile(mobile, 'utf8')
  assert.match(source, /event\.child_id === child\?\.id/)
  assert.match(source, /new Date\(b\.completed_at\) - new Date\(a\.completed_at\)/)
})

// These exercise the same payload builder and visual resolver used by both clients.
import { missionIconOptions, missionIcon, completionIcon, missionVisualFields } from '../mobile/missionIcons.mjs'

test('all supported visual payloads persist a key and no glyph or location', () => {
  for (const [key] of missionIconOptions) {
    assert.deepEqual(missionVisualFields(key), { icon_key: key })
    assert.match(key, /^[a-z]+(?:_[a-z]+)*$/)
  }
  for (const invalid of ['https://example.com/a.png', '/icons/a.png', 'data:image/png;base64,abc', '\u2b50', 'toString', '__proto__', '', null]) {
    assert.throws(() => missionVisualFields(invalid), /valid mission icon/)
  }
})

test('current mission visuals never consult legacy emoji and keyed history wins', () => {
  assert.equal(missionIcon({ icon_key: 'book', emoji: 'legacy' }), missionIcon({ icon_key: 'book' }))
  assert.equal(missionIcon({ emoji: 'legacy' }), missionIcon({ icon_key: 'star' }))
  assert.equal(missionIcon({ icon_key: 'toString', emoji: 'legacy' }), missionIcon({ icon_key: 'star' }))
  const snapshot = { icon_key_snapshot: 'book', emoji_snapshot: 'legacy' }
  assert.equal(completionIcon(snapshot), missionIcon({ icon_key: 'book' }))
  assert.equal(completionIcon({ icon_key_snapshot: null, emoji_snapshot: 'legacy' }), 'legacy')
})

test('pending migration removes emoji defaults and writes only key snapshots', async () => {
  const source = await readFile(migration, 'utf8')
  assert.match(source, /alter column emoji drop default/)
  assert.match(source, /alter column emoji drop not null/)
  assert.match(source, /revoke insert \(emoji\), update \(emoji\)/)
  assert.match(source, /add column icon_key_snapshot text/)
  assert.match(source, /alter column emoji_snapshot drop not null/)
  const rpc = source.slice(source.indexOf('create or replace function public.award_mission'))
  assert.match(rpc, /v_mission\.icon_key/)
  assert.doesNotMatch(rpc, /v_mission\.emoji|emoji_snapshot/)
  assert.doesNotMatch(source, /update public\.mission_completions/i)
})

test('key snapshot RPC preserves the existing cooldown, locking, and retry implementation', async () => {
  const old = await readFile(new URL('../supabase/migrations/20260921000100_repeatable_mission_cooldowns.sql', import.meta.url), 'utf8')
  const source = await readFile(migration, 'utf8')
  const extract = (sql) => sql.slice(sql.indexOf('create or replace function public.award_mission'), sql.indexOf('grant insert')).trim()
  assert.equal(extract(source), extract(old)
    .replace('mission_name_snapshot, emoji_snapshot', 'mission_name_snapshot, icon_key_snapshot')
    .replace('v_mission.name, v_mission.emoji', 'v_mission.name, v_mission.icon_key'))
})

test('follow-up migration removes the live emoji column after key migration', async () => {
  const source = await readFile(iconKeyOnlyMigration, 'utf8')
  assert.match(source, /alter table public\.missions\s+drop column emoji/i)
  assert.match(source, /no URI, path, URL, base64 value, or emoji is stored/i)
  assert.match(source, /Legacy historical display snapshot only/i)
})

test('mobile mission loading requests only the key-based visual field', async () => {
  const source = await readFile(mobile, 'utf8')
  assert.match(source, /from\('missions'\)\.select\('id, family_id, category_id, name, icon_key, stars, frequency, repeat_cooldown_seconds, archived_at, created_at, sort_order'\)/)
  assert.doesNotMatch(source, /from\('missions'\)\.select\('\*'\)/)
})


test('expanded icon constraints accept every registry key without rewriting history', async () => {
  const { missionIconOptions } = await import('../mobile/missionIcons.mjs')
  const sql = await readFile(new URL('../supabase/migrations/20260927000400_expand_mission_icons.sql', import.meta.url), 'utf8')
  assert.equal(missionIconOptions.length, 41)
  assert.ok(missionIconOptions.some(([key]) => key === 'poop'))
  for (const [key] of missionIconOptions) assert.equal(sql.split("'" + key + "'").length - 1, 2)
  assert.doesNotMatch(sql, /\b(update|delete|insert|create or replace function)\b/i)
})
