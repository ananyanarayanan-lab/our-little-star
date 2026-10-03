import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('mobile parent controls add and switch children without changing mission storage', async () => {
  const source = await readFile(new URL('../mobile/App.js', import.meta.url), 'utf8')
  assert.match(source, /function ChildrenSheet/)
  assert.match(source, /function AddChildSheet/)
  assert.match(source, /from\('children'\)\.insert\(\{ family_id: familyId, name: childName \}\)/)
  assert.match(source, /onManageChildren/)
  assert.match(source, /accessibilityLabel="Switch child"/)
  assert.match(source, /setChildrenSheetMode\('switch'\)/)
  assert.match(source, /setChildrenSheetMode\('manage'\)/)
  assert.match(source, /showAdd=\{childrenSheetMode === 'manage'\}/)
  assert.match(source, /\{showAdd \? <Pressable/)
  assert.doesNotMatch(source, /family\?\.time_zone \|\| ''/)
  assert.match(source, /selectedChildId/)
  assert.match(source, /children\.find\(\(item\) => item\.id === selectedChildId\) \|\| children\[0\] \|\| null/)
  assert.match(source, /event\.child_id === child\?\.id/)
  assert.doesNotMatch(source, /from\('missions'\)\.insert\([^)]*child_id/)
})
