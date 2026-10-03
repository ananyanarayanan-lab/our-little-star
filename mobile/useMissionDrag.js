import { friendlyError } from './userFeedback.mjs'
﻿import { useEffect, useRef, useState } from 'react'
import { dragDestination, moveMission, MISSION_ROW_STEP } from './missionOrdering.mjs'

// One scroll owner: the existing sheet. Edge scrolling also works while the
// finger is stationary, and compensates the dragged row for the scroll offset.
export function useMissionDrag({ missions, visible, disabled, onReorder, onError }) {
  const [drag, setDrag] = useState(null)
  const [saving, setSaving] = useState(false)
  const active = useRef(null)
  const savingRef = useRef(false)
  const scrollRef = useRef(null)
  const metrics = useRef({ offset: 0, height: 0, top: 0, contentHeight: 0 })
  const latest = useRef(null)
  latest.current = { missions, disabled, onReorder, onError }

  function measureViewport() {
    const viewport = scrollRef.current?.getNativeScrollRef?.() || scrollRef.current
    viewport?.measureInWindow?.((_x, top, _width, height) => {
      metrics.current.top = top; metrics.current.height = height
    })
  }
  function move(pageY) {
    const current = active.current
    if (!current) return
    current.lastY = pageY
    current.delta = Math.max(-current.from * MISSION_ROW_STEP, Math.min((current.ids.length - 1 - current.from) * MISSION_ROW_STEP, pageY - current.startY + metrics.current.offset - current.startScroll))
    current.to = dragDestination(current.from, current.delta, current.ids.length)
    setDrag({ ...current })
  }
  function begin(id, pageY) {
    if (latest.current.disabled || savingRef.current || active.current) return false
    const ids = latest.current.missions.map((mission) => mission.id)
    const from = ids.indexOf(id)
    if (from < 0) return false
    measureViewport()
    active.current = { id, ids, from, to: from, startY: pageY, lastY: pageY, startScroll: metrics.current.offset, delta: 0 }
    setDrag({ ...active.current })
    return true
  }
  function cancel() { active.current = null; setDrag(null) }
  async function persist(before, after) {
    if (savingRef.current || before.every((id, index) => id === after[index])) return
    savingRef.current = true; setSaving(true)
    try { await latest.current.onReorder(after) }
    catch (problem) { latest.current.onError(friendlyError(problem, 'Could not save mission order. Please try again.')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  async function end() {
    const current = active.current
    if (!current) return
    cancel()
    await persist(current.ids, moveMission(current.ids, current.from, current.to))
  }
  async function nudge(id, direction) {
    if (latest.current.disabled || active.current || savingRef.current) return
    const ids = latest.current.missions.map((mission) => mission.id)
    const from = ids.indexOf(id)
    await persist(ids, moveMission(ids, from, from + direction))
  }
  const idsKey = missions.map((mission) => mission.id).join(',')
  useEffect(() => {
    if (!visible || (active.current && active.current.ids.join(',') !== idsKey)) cancel()
  }, [visible, idsKey])
  useEffect(() => {
    if (!drag?.id) return undefined
    const timer = setInterval(() => {
      const current = active.current, viewport = metrics.current
      if (!current || !viewport.height) return
      const direction = current.lastY < viewport.top + 48 ? -1 : current.lastY > viewport.top + viewport.height - 48 ? 1 : 0
      const next = Math.max(0, Math.min(Math.max(0, viewport.contentHeight - viewport.height), viewport.offset + direction * 12))
      if (next === viewport.offset) return
      viewport.offset = next
      scrollRef.current?.scrollTo({ y: next, animated: false })
      move(current.lastY)
    }, 32)
    return () => clearInterval(timer)
  }, [drag?.id])
  return {
    drag, saving, begin, move, end, cancel, nudge, scrollRef, measureViewport,
    onScroll: (event) => { metrics.current.offset = event.nativeEvent.contentOffset.y; if (active.current) move(active.current.lastY) },
    onContentSizeChange: (_width, height) => { metrics.current.contentHeight = height },
  }
}
