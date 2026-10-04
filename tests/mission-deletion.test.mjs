import { friendlyError } from '../mobile/userFeedback.mjs'
import { sortMissions, saveMissionOrder, moveMission, dragDestination, missionRowOffset, MISSION_ROW_HEIGHT, MISSION_ROW_STEP } from '../mobile/missionOrdering.mjs'
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { softDeleteMission } from '../mobile/missionDeletion.mjs'
import { missionIcon, missionIconOptions, missionVisualFields } from '../mobile/missionIcons.mjs'

const require = createRequire(new URL('../mobile/package.json', import.meta.url))
const babel = require('@babel/core')
const jsxPlugin = require('@babel/plugin-transform-react-jsx')
const source = await readFile(new URL('../mobile/App.js', import.meta.url), 'utf8')
const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } })

const dragSource = await readFile(new URL('../mobile/useMissionDrag.js', import.meta.url), 'utf8')
const dragAst = babel.parseSync(dragSource, { configFile: false, babelrc: false })
ast.program.body.push(dragAst.program.body.find((node) => node.type === 'ExportNamedDeclaration').declaration)

// Execute the actual component handlers with deterministic hook state and native
// element stubs. No hosted account or production data is used by these tests.
function component(name, dependencies = {}, syntaxTree = ast) {
  const slots = []
  let cursor = 0
  const useState = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const useRef = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current: initial }
    return slots[index]
  }
  const element = (type, props, ...children) => ({ type, props: { ...props, children } })
  const primitives = Object.fromEntries(['SafeAreaView', 'Text', 'View', 'Pressable', 'ScrollView', 'TextInput', 'Modal', 'DraggableBottomSheet', 'ManageMissionsSheet', 'MissionEditorSheet', 'ManageRewardsSheet', 'RewardEditorSheet', 'MissionDragHandle', 'ParentControlsSheet', 'InviteParentSheet', 'ChildrenSheet', 'AddChildSheet', 'Celebration', 'RewardsScreen', 'RedemptionSuccess'].map((key) => [key, key]))
  const globals = {
    ...primitives, useState, useRef, useEffect: () => {}, element, Fragment: 'Fragment',
    styles: {}, friendlyError, sortMissions, saveMissionOrder, moveMission, dragDestination, missionRowOffset, MISSION_ROW_HEIGHT, MISSION_ROW_STEP, missionIcon, missionIconOptions, missionVisualFields, softDeleteMission,
    cooldownPresets: [60, 120, 300], shortActivityLabels: {}, rewardIcons: { gift: '🎁', chocolate: '🍫', park: '🌳', toy: '🧸', trophy: '🏆' },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    Animated: { Value: class { constructor(value) { this.value = value } }, View: 'AnimatedView' },
    ...dependencies,
  }
  const names = [name, 'useMissionDrag', 'formatCooldown', 'displayMissionName', 'unwrap', 'rewardPresentation', 'rewardDisplay', 'normalizeRewardDraft']
  const body = syntaxTree.program.body.filter((node) => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  assert.ok(body.some((node) => node.id.name === name))
  const { code } = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'script', body } }, '', {
    configFile: false, babelrc: false, plugins: [[jsxPlugin, { pragma: 'element', pragmaFrag: 'Fragment' }]],
  })
  const render = new Function(...Object.keys(globals), code + '\nreturn ' + name)(...Object.values(globals))
  return { render(props) { cursor = 0; return render(props) } }
}

function nodes(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (node.props?.visible === false) return []
  return [node, ...nodes(node.props?.children)]
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (!node || node.props?.visible === false) return ''
  return text(node.props?.children)
}
function button(tree, label) {
  const match = nodes(tree).find((node) => ['Pressable', 'button'].includes(node.type) && text(node) === label)
  assert.ok(match, 'button ' + label + ' exists')
  return match
}
function dialog(tree) { return nodes(tree).find((node) => node.type === 'Modal') }

function scene() {
  const data = {
    family: { id: 'family', time_zone: 'UTC' }, children: [{ id: 'child', name: 'Child' }],
    missions: [{ id: 'used', name: 'Read a book', sort_order: 10, icon_key: 'book', repeat_cooldown_seconds: 120, stars: 1 }, { id: 'old', name: 'Previously deleted', archived_at: '2026-01-01' }],
    completions: [{ id: 'event', child_id: 'child', mission_id: 'used', icon_key_snapshot: 'book', stars_earned: 5, completed_at: '2026-01-01T00:00:00Z', undone_at: null }],
    balances: [{ child_id: 'child', balance: 3 }], redemptions: [{ id: 'reward', stars_spent: 2 }],
  }
  const writes = []
  const orderWrites = []
  let fail = false
  const client = { async rpc(name, args) {
    assert.equal(name, 'reorder_missions')
    assert.equal(args.p_family_id, 'family')
    const active = data.missions.filter((row) => !row.archived_at)
    assert.deepEqual([...args.p_mission_ids].sort(), active.map((row) => row.id).sort())
    orderWrites.push(args.p_mission_ids)
    return { data: args.p_mission_ids.map((id, i) => {
      data.missions.find((row) => row.id === id).sort_order = (i + 1) * 10
      return { id, sort_order: (i + 1) * 10 }
    }) }
  }, from(table) {
    assert.equal(table, 'missions', 'deletion never touches the ledger or rewards')
    return {
      async insert(row) { data.missions.push({ ...row, id: 'new' }); return { error: null } },
      update(patch) {
        writes.push(patch)
        return { eq(column, id) {
          assert.equal(column, 'id')
          return { select(fields) {
            assert.equal(fields, 'id')
            return { async single() {
              await Promise.resolve()
              if (fail) return { error: new Error('Connection unavailable') }
              Object.assign(data.missions.find((row) => row.id === id), patch)
              return { data: { id }, error: null }
            } }
          } }
        } }
      },
    }
  } }
  const home = component('Home', { supabase: client })
  const manager = component('ManageMissionsSheet')
  const homeProps = { data, refresh: async () => ({ ok: false }), onSignOut() {} }
  const renderHome = () => home.render(homeProps)
  // Open the real parent-control callback so the manager is visible.
  nodes(renderHome()).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Parent settings').props.onPress()
  nodes(renderHome()).find((node) => node.type === 'ParentControlsSheet').props.onManageMissions()
  const renderManager = () => manager.render(nodes(renderHome()).find((node) => node.type === 'ManageMissionsSheet').props)
  return { data, client, writes, orderWrites, renderHome, renderManager, fail() { fail = true } }
}

test('create, open Delete, and cancel leave the mission available without a write', async () => {
  const s = scene()
  const editor = component('MissionEditorSheet', { supabase: s.client })
  const props = { visible: true, familyId: 'family', mission: null, onSaved() {}, onDismiss() {} }
  nodes(editor.render(props)).find((node) => node.props.accessibilityLabel === 'Mission name').props.onChangeText('New mission')
  await button(editor.render(props), 'Add mission').props.onPress()
  assert.ok(text(s.renderHome()).includes('New mission'))
  const row = nodes(s.renderManager()).find((node) => node.props.key === 'new')
  button(row, 'Delete').props.onPress()
  const confirmation = dialog(s.renderManager())
  assert.ok(text(confirmation).includes('Delete mission?'))
  assert.ok(text(confirmation).includes('Are you sure you want to delete this mission?'))
  button(confirmation, 'Cancel').props.onPress()
  assert.equal(dialog(s.renderManager()), undefined)
  assert.equal(s.writes.length, 0)
  assert.ok(text(s.renderHome()).includes('New mission'))
  assert.ok(text(s.renderManager()).includes('New mission'))
  button(nodes(s.renderManager()).find((node) => node.props.key === 'new'), 'Delete').props.onPress()
  await button(dialog(s.renderManager()), 'Delete').props.onPress()
  assert.ok(!text(s.renderHome()).includes('New mission'))
  assert.ok(!text(s.renderManager()).includes('New mission'))
  assert.ok(text(s.renderHome()).includes('Read a book'))
  assert.equal(s.data.balances[0].balance, 3)
})

test('confirmed Delete immediately hides a used mission, preserves history and balance, and offers no restore', async () => {
  const s = scene()
  const history = structuredClone({ completions: s.data.completions, balances: s.data.balances, redemptions: s.data.redemptions })
  assert.ok(!text(s.renderManager()).includes('Previously deleted'))
  button(s.renderManager(), 'Delete').props.onPress()
  const confirm = button(dialog(s.renderManager()), 'Delete')
  const pending = confirm.props.onPress()
  // Even a second tap before React renders cannot submit another update.
  await confirm.props.onPress()
  assert.ok(!text(s.renderHome()).includes('Read a book'))
  assert.ok(!text(s.renderManager()).includes('Read a book'))
  await pending
  assert.equal(s.writes.length, 1)
  assert.deepEqual(Object.keys(s.writes[0]), ['archived_at'])
  assert.ok(s.data.missions.find((row) => row.id === 'used').archived_at)
  assert.equal(s.data.missions.length, 2, 'database row is retained')
  assert.deepEqual({ completions: s.data.completions, balances: s.data.balances, redemptions: s.data.redemptions }, history)
  assert.equal(dialog(s.renderManager()), undefined)
  assert.doesNotMatch(text(s.renderManager()), /Archive|Archived|Restore/)
  // A fresh app session still excludes both soft-deleted rows.
  assert.doesNotMatch(text(component('ManageMissionsSheet').render({ visible: true, missions: s.data.missions })), /Read a book|Previously deleted|Restore/)
})

test('a failed delete puts the mission back and keeps confirmation available for retry', async () => {
  const s = scene(); s.fail()
  button(s.renderManager(), 'Delete').props.onPress()
  await button(dialog(s.renderManager()), 'Delete').props.onPress()
  assert.ok(text(s.renderHome()).includes('Read a book'))
  assert.ok(text(s.renderManager()).includes('Read a book'))
  assert.ok(text(dialog(s.renderManager())).includes('Could not delete this mission. Please try again.'))
  assert.equal(s.data.missions[0].archived_at, undefined)
  assert.equal(s.data.balances[0].balance, 3)
})

test('a zero-row deletion response is treated as a failure', async () => {
  const client = { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }) }
  await assert.rejects(softDeleteMission(client, 'missing'), /Could not delete/)
})

test('hosted web mission manager also hides old deletions and confirms Delete', async () => {
  const webSource = await readFile(new URL('../src/SharedFamilyData.jsx', import.meta.url), 'utf8')
  const webAst = babel.parseSync(webSource, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } })
  const manager = component('MissionManager', { MissionIconPicker: 'MissionIconPicker' }, webAst)
  let deleted = 0
  const props = { data: { missions: [{ id: 'live', name: 'Current mission', icon_key: 'book' }, { id: 'old', name: 'Previously deleted', archived_at: '2026-01-01' }] }, onDeleteMission: async () => { deleted++; props.data.missions[0].archived_at = '2026-09-27' } }
  const render = () => manager.render(props)
  assert.doesNotMatch(text(render()), /Previously deleted|Archive|Archived|Restore/)
  button(render(), 'Delete').props.onClick()
  let confirmation = nodes(render()).find((node) => node.type === 'dialog')
  assert.ok(text(confirmation).includes('Delete mission?'))
  assert.ok(text(confirmation).includes('Are you sure you want to delete this mission?'))
  button(confirmation, 'Cancel').props.onClick()
  assert.equal(deleted, 0)
  button(render(), 'Delete').props.onClick()
  confirmation = nodes(render()).find((node) => node.type === 'dialog')
  await button(confirmation, 'Delete').props.onClick()
  assert.equal(deleted, 1)
  assert.doesNotMatch(text(render()), /Current mission|Previously deleted|Restore/)
})

test('home keeps its header fixed and renders 60 missions in one vertical scroll area', () => {
  const styleNode = ast.program.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((declaration) => declaration.id.name === 'styles'))
  const { code } = babel.transformFromAstSync({ type: 'File', program: { type: 'Program', sourceType: 'script', body: [styleNode] } }, '', { configFile: false, babelrc: false })
  const styles = new Function('StyleSheet', code + '\nreturn styles')({ create: (value) => value, absoluteFillObject: {} })
  for (const width of [320, 390, 740]) {
    const home = component('Home', {
      styles,
      useWindowDimensions: () => ({ width, height: 844 }),
      useSafeAreaInsets: () => ({ top: 32, bottom: 34 }),
    })
    const missions = Array.from({ length: 60 }, (_, i) => ({ id: 'mission-' + i, name: 'Mission ' + i, sort_order: (i + 1) * 10, icon_key: 'book', stars: 1, repeat_cooldown_seconds: 120 }))
    const tree = home.render({ data: { children: [{ id: 'child', name: 'Pinned child' }], missions, balances: [{ child_id: 'child', balance: 42 }] } })
    const scrolls = nodes(tree).filter((node) => node.type === 'ScrollView')
    assert.equal(scrolls.length, 1)
    const scroll = scrolls[0]
    const header = nodes(tree).find((node) => node.props.style === styles.homeHeader)
    assert.ok(text(header).includes('Pinned child'))
    assert.doesNotMatch(text(tree), /What did you do today/)
    assert.ok(nodes(header).some((node) => node.props.accessibilityLabel === 'Parent settings'))
    assert.ok(nodes(header).some((node) => node.props.accessibilityLabel === 'Open rewards' && text(node).includes('42')))
    assert.ok(!nodes(scroll).includes(header))
    assert.doesNotMatch(text(scroll), /Pinned child|What did you do today|doing amazing/)
    assert.equal(styles.home.flex, 1)
    assert.equal(styles.homeHeader.flexShrink, 0)
    const viewport = nodes(tree).find(n => n.props.style === styles.missionViewport)
    assert.ok(nodes(viewport).includes(scroll))
    assert.equal(styles.missionViewport.flexBasis, 0)
    assert.equal(styles.missionViewport.overflow, 'hidden')
    assert.equal(scroll.props.horizontal, false)
    assert.equal(scroll.props.showsHorizontalScrollIndicator, false)
    assert.equal(scroll.props.removeClippedSubviews, false)
    assert.equal(scroll.props.contentContainerStyle.paddingBottom, 28)
    const footer = nodes(tree).find((node) => Array.isArray(node.props.style) && node.props.style[0] === styles.homeFooter)
    assert.ok(footer.props.style[1].paddingBottom >= 34, 'footer reserves the bottom navigation safe area outside the scroll viewport')
    const homeLayout = nodes(tree).find((node) => Array.isArray(node.props.style) && node.props.style[0] === styles.home)
    assert.ok(homeLayout.props.style[1].paddingTop >= 32)
    const cards = nodes(scroll).filter((node) => node.type === 'Pressable')
    assert.equal(cards.length, 60)
    assert.equal(cards.at(-1).props.accessibilityLabel, 'Complete Mission 59')
    const cardWidth = cards[0].props.style({ pressed: false })[1].width
    const available = width - 2 * styles.missionScrollContent.paddingHorizontal
    assert.ok(3 * cardWidth + 2 * styles.grid.gap <= available)
    assert.ok(4 * cardWidth + 3 * styles.grid.gap > available)
    assert.equal(styles.grid.flexDirection, 'row')
    assert.equal(styles.grid.flexWrap, 'wrap')
  }
})

test('dragging moves rows, saves once, survives reopening/reload, and preserves edit/delete/cooldown', async () => {
  const s = scene()
  s.data.missions.push({ id: 'b', name: 'Second', sort_order: 20, icon_key: 'book' }, { id: 'c', name: 'Third', sort_order: 30, icon_key: 'book' })
  s.data.completions[0].completed_at = new Date().toISOString()
  const history = structuredClone(s.data.completions)
  const managerRows = () => nodes(s.renderManager()).filter((node) => node.props.key && s.data.missions.some((row) => row.id === node.props.key))
  const handle = nodes(s.renderManager()).find((node) => node.type === 'MissionDragHandle' && node.props.mission.id === 'c')
  assert.ok(handle.props.onStart('c', 400))
  handle.props.onMove(400 - 2 * MISSION_ROW_STEP)
  const during = managerRows()
  assert.equal(during.find((node) => node.props.key === 'c').props.style[1].transform[0].translateY, -2 * MISSION_ROW_STEP)
  assert.equal(during.find((node) => node.props.key === 'used').props.style[1].transform[0].translateY, MISSION_ROW_STEP)
  await handle.props.onEnd()
  assert.deepEqual(s.orderWrites, [['c', 'used', 'b']])
  assert.deepEqual(managerRows().map((node) => node.props.key), ['c', 'used', 'b'])
  const cards = (tree) => nodes(tree).filter((node) => node.props.accessibilityLabel?.startsWith('Complete '))
  assert.deepEqual(cards(s.renderHome()).map((node) => node.props.accessibilityLabel), ['Complete Third', 'Complete Read a book', 'Complete Second'])
  assert.equal(cards(s.renderHome())[1].props.disabled, true, 'cooldown remains active after reorder')
  const sheet = nodes(s.renderHome()).find((node) => node.type === 'ManageMissionsSheet')
  sheet.props.onDismiss()
  nodes(s.renderHome()).find((node) => node.type === 'ParentControlsSheet').props.onManageMissions()
  assert.deepEqual(managerRows().map((node) => node.props.key), ['c', 'used', 'b'])
  const reloaded = component('Home').render({ data: structuredClone(s.data) })
  assert.deepEqual(cards(reloaded).map((node) => node.props.accessibilityLabel), ['Complete Third', 'Complete Read a book', 'Complete Second'])
  button(managerRows().find((node) => node.props.key === 'used'), 'Edit').props.onPress()
  const editor = nodes(s.renderHome()).find((node) => node.type === 'MissionEditorSheet')
  assert.equal(editor.props.mission.id, 'used')
  editor.props.onDismiss()
  button(managerRows().find((node) => node.props.key === 'b'), 'Delete').props.onPress()
  await button(dialog(s.renderManager()), 'Delete').props.onPress()
  assert.deepEqual(cards(s.renderHome()).map((node) => node.props.accessibilityLabel), ['Complete Third', 'Complete Read a book'])
  assert.deepEqual(s.data.completions, history)
  assert.equal(s.data.balances[0].balance, 3)
})

test('cancelling a drag or dropping in the same slot does not persist', async () => {
  const s = scene()
  const handle = nodes(s.renderManager()).find((node) => node.type === 'MissionDragHandle')
  handle.props.onStart('used', 200); handle.props.onMove(220); await handle.props.onEnd()
  handle.props.onStart('used', 200); handle.props.onCancel(); await handle.props.onEnd()
  assert.equal(s.orderWrites.length, 0)
})

test('reorder errors restore the previous home order and surface a retry message', async () => {
  const s = scene()
  s.data.missions.push({ id: 'b', name: 'Second', sort_order: 20, icon_key: 'book' })
  s.client.rpc = async () => ({ error: new Error('Mission list changed. Refresh and try again.') })
  const handle = nodes(s.renderManager()).find((node) => node.type === 'MissionDragHandle' && node.props.mission.id === 'b')
  handle.props.onStart('b', 300); handle.props.onMove(300 - MISSION_ROW_STEP); await handle.props.onEnd()
  assert.ok(text(s.renderManager()).includes('Could not save mission order. Please try again.'))
  assert.deepEqual(nodes(s.renderHome()).filter((node) => node.props.accessibilityLabel?.startsWith('Complete ')).map((node) => node.props.accessibilityLabel), ['Complete Read a book', 'Complete Second'])
})

test('drag handles require holding and forward move/drop without firing Edit or Delete', () => {
  let hold = null, started = 0, ended = 0, moved = 0
  const handle = component('MissionDragHandle', {
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
    setTimeout: (callback) => { hold = callback; return 1 }, clearTimeout: () => { hold = null },
  })
  const props = { mission: { id: 'a', name: 'First' }, disabled: false, onStart: () => { started++; return true }, onMove: () => { moved++ }, onEnd: () => { ended++ }, onCancel() {} }
  const view = handle.render(props)
  assert.equal(view.props.onStartShouldSetPanResponder(), true)
  view.props.onPanResponderGrant({ nativeEvent: { pageY: 200 } })
  assert.equal(started, 0)
  hold()
  view.props.onPanResponderMove({ nativeEvent: { pageY: 300 } }, { dy: 100 })
  view.props.onPanResponderRelease()
  assert.equal(started, 1); assert.equal(moved, 1); assert.equal(ended, 1)
  assert.equal(handle.render({ ...props, disabled: true }).props.onStartShouldSetPanResponder(), false)
})

test('edge scrolling moves a long list while the finger stays still', () => {
  let tick = null
  const effects = [], positions = []
  const hook = component('useMissionDrag', { useEffect: (effect) => { effects.push(effect) }, setInterval: (callback) => { tick = callback; return 1 }, clearInterval() {} })
  const props = { missions: Array.from({ length: 30 }, (_, i) => ({ id: String(i) })), visible: true, onReorder() {}, onError() {} }
  let state = hook.render(props)
  state.scrollRef.current = { measureInWindow: (callback) => callback(0, 100, 300, 300), scrollTo: ({ y }) => positions.push(y) }
  state.onContentSizeChange(300, 3000)
  state.begin('0', 200); state.move(390)
  state = hook.render(props)
  const cleanups = effects.splice(0).map((effect) => effect()).filter(Boolean)
  for (let i = 0; i < 10; i++) tick()
  state = hook.render(props)
  assert.ok(positions.at(-1) > 0)
  assert.ok(state.drag.to >= 3)
  state.cancel()
  cleanups.forEach((cleanup) => cleanup())
})


test('empty home explains parent setup; long labels and large balances stay bounded', () => {
  for (const width of [320, 390, 1024]) {
    const home = component('Home', { useWindowDimensions: () => ({ width, height: 844 }) })
    const data = { children: [{ id: 'child', name: 'A very long child name that should stay beside settings' }], balances: [{ child_id: 'child', balance: 123456789 }], missions: [] }
    assert.match(text(home.render({ data })), /Ready to get started.*Add a mission in Parent Controls/s)
    data.missions = [{ id: 'long', name: 'A'.repeat(80), icon_key: 'poop', stars: 1 }]
    const tree = home.render({ data })
    const card = nodes(tree).find(n => n.props.accessibilityLabel === 'Complete ' + 'A'.repeat(80))
    assert.ok(card.props.style({ pressed: false })[1].width <= 180)
    assert.equal(nodes(card).find(n => text(n) === 'A'.repeat(80)).props.numberOfLines, 2)
    assert.ok(nodes(tree).some(n => n.props.numberOfLines === 1 && text(n) === '123456789'))
  }
})

test('rapid mission taps submit once, show immediate celebration and preserve cooldown after reload', async () => {
  let resolve, calls = 0
  const pending = new Promise(r => { resolve = r })
  const data = { family: { time_zone: 'UTC' }, children: [{ id: 'child' }], missions: [{ id: 'm', name: 'Read', stars: 1, repeat_cooldown_seconds: 120 }], balances: [{ child_id: 'child', balance: 2 }] }
  const home = component('Home', { Crypto: { randomUUID: () => 'request' }, Haptics: { ImpactFeedbackStyle: {}, NotificationFeedbackType: {}, impactAsync: async () => {}, notificationAsync: async () => {} }, supabase: { rpc: () => { calls++; return pending } } })
  const props = { data, refresh: async () => ({ ok: false }) }
  const tap = nodes(home.render(props)).find(n => n.props.accessibilityLabel === 'Complete Read').props.onPress
  const first = tap(); await tap()
  assert.equal(calls, 1)
  assert.ok(nodes(home.render(props)).some(n => n.type === 'Celebration'))
  resolve({ data: 'completion' }); await first
  data.completions = [{ child_id: 'child', mission_id: 'm', completed_at: new Date().toISOString() }]
  const reloaded = component('Home').render(props)
  assert.equal(nodes(reloaded).find(n => n.props.accessibilityLabel === 'Complete Read').props.disabled, true)
  data.completions[0].completed_at = new Date(Date.now() - 121000).toISOString()
  assert.equal(nodes(component('Home').render(props)).find(n => n.props.accessibilityLabel === 'Complete Read').props.disabled, false)
})

test('rewards keep four cards and encouragement with locked and redeem states on common portrait phone sizes', () => {
  const rewards = [10, 20, 30, 50].map(star_cost => ({ id: String(star_cost), star_cost, name: 'Long reward '.repeat(5) }))
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [412, 915]]) {
    let redeemed
    const screen = component('RewardsScreen', { useWindowDimensions: () => ({ width, height }) })
    const tree = screen.render({ visible: true, balance: 25, rewards, onRedeem: value => { redeemed = value } })
    assert.match(text(tree), /Keep going/)
    assert.equal(nodes(tree).filter(node => node.type === 'ScrollView').length, 0)
    assert.equal(nodes(tree).filter(n => n.props.accessibilityLabel?.startsWith('Redeem ')).length, 2)
    assert.match(text(tree), /Need 5 more stars/)
    nodes(tree).find(n => n.props.accessibilityLabel?.startsWith('Redeem ')).props.onPress()
    assert.equal(redeemed.stars, 10)
  }
})


test('shared parent sheet follows drag, springs back, dismisses and pads scrolling above navigation', () => {
  const values = [], springs = []
  let dismissed = 0
  const animate = () => ({ start: done => done?.({ finished: true }) })
  const sheet = component('DraggableBottomSheet', {
    KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
    PanResponder: { create: handlers => ({ panHandlers: handlers }) },
    useSafeAreaInsets: () => ({ bottom: 34 }),
    Animated: { Value: class { setValue(v) { values.push(v) } stopAnimation() {} }, View: 'AnimatedView', add: () => 0, parallel: animate, timing: animate, spring: (_v, config) => { springs.push(config.toValue); return animate() } },
  })
  const tree = sheet.render({ visible: true, title: 'Manage missions', onDismiss: () => { dismissed++ } })
  const zone = nodes(tree).find(n => n.props.onPanResponderMove)
  zone.props.onPanResponderGrant()
  zone.props.onPanResponderMove(null, { dy: 60 })
  assert.equal(values.at(-1), 60)
  zone.props.onPanResponderRelease(null, { dy: 60, vy: 0 })
  assert.equal(springs.at(-1), 0)
  assert.equal(dismissed, 0)
  zone.props.onPanResponderRelease(null, { dy: 150, vy: 0 })
  assert.equal(dismissed, 1)
  const scroll = nodes(tree).find(n => n.type === 'ScrollView')
  assert.equal(scroll.props.contentContainerStyle[1].paddingBottom, 66)
  assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled')
  nodes(tree).find(n => n.props.accessibilityLabel === 'Dismiss Manage missions').props.onPress()
  assert.equal(dismissed, 2)
})
