// "선택" 기능: 선택 버튼을 누르면 파일을 여러 개 고를 수 있다.
// 고른 채로 다른 폴더(또는 임시함)로 가서 아래 막대의 "여기로 이동 / 여기로 복사"를 누르면 그곳으로 옮기거나 복사한다.
// 화면을 옮겨 다녀도 고른 것이 유지되도록 화면 전체(App)에 하나만 둔다.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BatchTarget } from './api'

/** 지금 보고 있는 곳. null이면 이동/복사할 수 없는 화면 (메인, 휴지통) */
export type Here = { target: BatchTarget; label: string } | null

interface SelectionValue {
  active: boolean
  ids: Set<number>
  start: () => void
  stop: () => void
  toggle: (id: number) => void
  here: Here
  setHere: (h: Here) => void
}

const SelectionContext = createContext<SelectionValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [ids, setIds] = useState<Set<number>>(() => new Set())
  const [here, setHere] = useState<Here>(null)

  const start = useCallback(() => setActive(true), [])
  const stop = useCallback(() => {
    setActive(false)
    setIds(new Set())
  }, [])
  const toggle = useCallback((id: number) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const value = useMemo(() => ({ active, ids, start, stop, toggle, here, setHere }), [active, ids, start, stop, toggle, here])
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('SelectionProvider 안에서만 쓸 수 있습니다')
  return ctx
}

/** 화면별로 "여기로 이동/복사"의 "여기"를 정한다. 화면을 떠나면 비운다. */
export function useSetSelectionHere(here: Here) {
  const { setHere } = useSelection()
  const key = JSON.stringify(here)
  useEffect(() => {
    setHere(here)
    return () => setHere(null)
    // here는 매번 새 객체라서 내용(key)으로 바뀜을 판단한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setHere])
}
