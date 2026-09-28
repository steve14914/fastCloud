// "선택" 기능 (PC 파일 관리자처럼):
//   1. 선택 버튼 → 지금 보고 있는 경로에서 파일·폴더를 여러 개 고른다 (Ctrl+클릭: 하나씩 더하기/빼기, Shift+클릭: 범위)
//   2. 이동(또는 복사) 버튼 → 옮길 곳을 고르는 상태가 된다
//   3. 원하는 경로로 간다 (위쪽 경로 표시줄, 폴더 누르기)
//   4. 완료 버튼 → 그곳으로 옮기거나 복사한다
// 고르는 중(1)에 다른 경로로 가면 선택이 풀린다. 옮길 곳을 고르는 중(2~3)에는 경로를 옮겨 다녀도 유지된다.
// 화면을 옮겨 다녀도 유지되도록 화면 전체(App)에 하나만 둔다.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BatchTarget } from './api'

/** 고른 것 하나. 'f12' = 파일 12, 'd3' = 폴더 3 */
export type ItemKey = string
export const fileKey = (id: number): ItemKey => `f${id}`
export const folderKey = (id: number): ItemKey => `d${id}`

/** 고른 것을 파일 id와 폴더 id로 나눈다 */
export function splitKeys(keys: Iterable<ItemKey>) {
  const files: number[] = []
  const folders: number[] = []
  for (const k of keys) (k[0] === 'd' ? folders : files).push(Number(k.slice(1)))
  return { files, folders }
}

/** 지금 보고 있는 곳. key는 같은 곳인지 비교하는 데 쓴다. null이면 옮길 수 없는 화면 (메인, 휴지통) */
export type Here = { key: string; target: BatchTarget; label: string } | null

/** off: 선택 안 함, select: 고르는 중, move/copy: 옮길(복사할) 곳을 고르는 중 */
export type Phase = 'off' | 'select' | 'move' | 'copy'

/** 클릭할 때 누르고 있던 키 */
export type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

interface SelectionValue {
  phase: Phase
  /** 고르는 중인지 (체크 표시가 보이고 누르면 골라진다) */
  active: boolean
  keys: Set<ItemKey>
  /** 고르기 시작한 곳 (move/copy 중에 원래 자리로 완료하지 않게) */
  originKey: string | null
  start: () => void
  stop: () => void
  /** 항목을 눌렀다. 선택 중이 아니었는데 Ctrl/Shift를 누르고 있었으면 선택을 시작한다. */
  click: (key: ItemKey, mods: Mods) => void
  /** 고른 것을 옮길(복사할) 곳을 고르는 단계로 */
  beginTransfer: (kind: 'move' | 'copy') => void
  here: Here
  setHere: (h: Here) => void
  /** 지금 화면에 보이는 순서 (Shift+클릭 범위 선택에 쓴다) */
  setOrder: (keys: ItemKey[]) => void
}

const SelectionContext = createContext<SelectionValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('off')
  const [keys, setKeys] = useState<Set<ItemKey>>(() => new Set())
  const [here, setHereState] = useState<Here>(null)
  const [originKey, setOriginKey] = useState<string | null>(null)
  // 화면을 다시 그릴 필요가 없는 값은 ref에 둔다
  const order = useRef<ItemKey[]>([])
  const anchor = useRef<ItemKey | null>(null) // Shift+클릭 범위의 시작점 (마지막으로 누른 것)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const hereRef = useRef(here)
  hereRef.current = here

  const start = useCallback(() => {
    setPhase('select')
    setKeys(new Set())
    setOriginKey(hereRef.current?.key ?? null)
    anchor.current = null
  }, [])
  const stop = useCallback(() => {
    setPhase('off')
    setKeys(new Set())
    setOriginKey(null)
    anchor.current = null
  }, [])

  const click = useCallback(
    (key: ItemKey, mods: Mods) => {
      if (phaseRef.current !== 'select') {
        if (phaseRef.current !== 'off') return
        start()
      }
      const from = anchor.current
      if (mods.shiftKey && from) {
        // 범위: 마지막으로 누른 것부터 이번 것까지. Ctrl도 누르고 있으면 기존 선택에 더한다.
        const a = order.current.indexOf(from)
        const b = order.current.indexOf(key)
        if (a >= 0 && b >= 0) {
          const range = order.current.slice(Math.min(a, b), Math.max(a, b) + 1)
          setKeys((prev) => new Set([...(mods.ctrlKey || mods.metaKey ? prev : []), ...range]))
          return
        }
      }
      // 그냥 누르거나 Ctrl+클릭: 하나 더하기/빼기 (폰에서도 누르기만 하면 되도록 그냥 클릭도 같게)
      anchor.current = key
      setKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [start],
  )

  const beginTransfer = useCallback((kind: 'move' | 'copy') => setPhase(kind), [])

  const setHere = useCallback((h: Here) => {
    // 고르는 중에 다른 경로로 가면 선택을 푼다 (선택은 한 경로 안에서만)
    if (phaseRef.current === 'select' && hereRef.current?.key !== h?.key && h !== null) {
      setPhase('off')
      setKeys(new Set())
      anchor.current = null
    }
    setHereState(h)
  }, [])

  const setOrder = useCallback((keys: ItemKey[]) => {
    order.current = keys
  }, [])

  const value = useMemo(
    () => ({
      phase,
      active: phase === 'select',
      keys,
      originKey,
      start,
      stop,
      click,
      beginTransfer,
      here,
      setHere,
      setOrder,
    }),
    [phase, keys, originKey, start, stop, click, beginTransfer, here, setHere, setOrder],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('SelectionProvider 안에서만 쓸 수 있습니다')
  return ctx
}

/** 화면별로 "지금 보고 있는 곳"을 알린다. 화면을 떠나면 비운다. */
export function useSetSelectionHere(here: Here) {
  const { setHere, phase, stop } = useSelection()
  const key = JSON.stringify(here)
  useEffect(() => {
    setHere(here)
    return () => setHere(null)
    // here는 매번 새 객체라서 내용(key)으로 바뀜을 판단한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setHere])
  // 고르는 중에 이 화면(영구저장소·임시함)을 아예 떠나면 선택을 푼다
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useEffect(
    () => () => {
      if (phaseRef.current === 'select') stop()
    },
    [stop],
  )
}

/** 지금 화면에 보이는 항목 순서를 알린다 (Shift+클릭 범위 선택용) */
export function useSelectionOrder(keys: ItemKey[]) {
  const { setOrder } = useSelection()
  const joined = keys.join(',')
  useEffect(() => {
    setOrder(keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, setOrder])
}
