// 화면 안에서 파일·폴더를 끌어다 폴더에 넣는 기능.
//
// PC: 브라우저의 드래그앤드롭. 끌기 시작할 때 무엇을 끄는지 dataTransfer에 우리만 쓰는 형식으로 적어 두고, 폴더가 그걸 받는다.
//     (컴퓨터의 파일을 끌어와 올리는 것과 구분하려고 Layout에서도 이 형식을 확인한다)
// 폰: 브라우저 드래그앤드롭이 손가락으로는 동작하지 않아서 직접 만든다 (useTouchDrag).
//     길게 누르면 "들어 올린" 상태가 되고(진동 + 강조), 손가락을 따라 이름표가 움직이며, 놓은 자리의 폴더로 옮긴다.
//
// 놓을 수 있는 곳(폴더, 경로, "상위 폴더로 이동")은 useDropTarget을 쓰고, data-drop-folder 속성으로 폰 쪽에도 알린다.

import { useState, useSyncExternalStore, type DragEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { api } from './api'
import { useRefresh } from './refresh'

export const DND_TYPE = 'application/x-fastcloud-item'

/** 끄는 것. ids가 있으면 선택한 파일 여러 개를 한꺼번에 끄는 중 */
export type DragItem = { kind: 'file' | 'folder'; id: number; name: string; ids?: number[] }

// ---------- 지금 끄는 중인지 (위쪽 "상위 폴더로 이동" 칸을 보여 주는 데 쓴다) ----------

let dragging = false
const listeners = new Set<() => void>()
function setDragging(v: boolean) {
  if (dragging === v) return
  dragging = v
  listeners.forEach((l) => l())
}
export function useIsDragging() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => dragging,
  )
}
// 끌기가 끝나면(놓거나 취소) 꺼 둔다. 놓은 곳에서 이벤트를 멈춰도 알 수 있게 capture 단계에서 듣는다.
window.addEventListener('dragend', () => setDragging(false), true)
window.addEventListener('drop', () => setDragging(false), true)

// ---------- PC (브라우저 드래그앤드롭) ----------

export function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'move'
  // dragstart 안에서 바로 화면을 바꾸면 크롬이 끌기를 취소해 버려서 한 박자 늦춘다
  setTimeout(() => setDragging(true))
}

/** 끌고 있는 것이 우리 파일/폴더인지 (dragover 중에는 내용을 읽을 수 없고 형식만 볼 수 있다) */
export function isItemDrag(e: DragEvent | globalThis.DragEvent) {
  return e.dataTransfer?.types.includes(DND_TYPE) ?? false
}

export function readDrag(e: DragEvent): DragItem | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DND_TYPE))
  } catch {
    return null
  }
}

/** 끌어 온 파일/폴더를 폴더 folderId(null이면 영구저장소 맨 위)로 옮긴다. 옮길 게 없으면 false. */
export async function moveDragged(item: DragItem, folderId: number | null): Promise<boolean> {
  if (item.kind === 'file') {
    await api.moveFiles(item.ids ?? [item.id], { folderId })
    return true
  }
  if (item.id === folderId) return false // 자기 자신에게 놓음
  await api.moveFolder(item.id, folderId)
  return true
}

/**
 * 폴더(또는 "영구저장소 맨 위", "상위 폴더")를 놓을 자리로 만든다. 돌려준 props를 요소에 펼쳐 넣으면 된다.
 * over: 지금 그 위에 끌고 와 있는지 (강조 표시용. 폰에서 끌 때는 useTouchDrag가 직접 drop-over 클래스를 붙인다)
 */
export function useDropTarget(folderId: number | null) {
  const { refresh } = useRefresh()
  const [over, setOver] = useState(false)
  const props = {
    'data-drop-folder': folderId ?? 'root',
    onDragOver: (e: DragEvent) => {
      if (!isItemDrag(e)) return
      e.preventDefault() // 이걸 해야 여기에 놓을 수 있다
      e.dataTransfer.dropEffect = 'move'
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: async (e: DragEvent) => {
      setOver(false)
      const item = readDrag(e)
      if (!item) return
      e.preventDefault()
      e.stopPropagation()
      try {
        if (await moveDragged(item, folderId)) refresh()
      } catch (err) {
        alert((err as Error).message)
      }
    },
  }
  return { over, props }
}

// ---------- 폰 (길게 눌러 끌기) ----------

const LONG_PRESS_MS = 400
const MOVE_TOLERANCE = 10 // 길게 누르기 전에 이만큼(px) 움직이면 스크롤로 보고 취소한다

interface TouchState {
  item: DragItem
  el: HTMLElement
  startX: number
  startY: number
  timer: number
  active: boolean
  ghost: HTMLElement | null
  over: HTMLElement | null
  refresh: () => void
}
let touch: TouchState | null = null

/**
 * 손가락으로 길게 눌러 끌 수 있게 한다. 돌려준 props를 끌 요소에 펼쳐 넣는다.
 * getItem: 끌기가 시작될 때 무엇을 끄는지 (선택한 파일이 있으면 여러 개)
 */
export function useTouchDrag(getItem: () => DragItem, enabled = true) {
  const { refresh } = useRefresh()
  if (!enabled) return {}
  return {
    onTouchStart: (e: ReactTouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1 || touch) return
      const t = e.touches[0]
      touch = {
        item: getItem(),
        el: e.currentTarget,
        startX: t.clientX,
        startY: t.clientY,
        timer: window.setTimeout(liftUp, LONG_PRESS_MS),
        active: false,
        ghost: null,
        over: null,
        refresh,
      }
      // passive: false여야 끄는 동안 preventDefault로 화면 스크롤을 막을 수 있다
      document.addEventListener('touchmove', onTouchMove, { passive: false })
      document.addEventListener('touchend', onTouchEnd, { passive: false })
      document.addEventListener('touchcancel', endTouch)
    },
    // 길게 누르면 뜨는 메뉴(링크 열기, 이미지 저장 등)를 막는다
    onContextMenu: (e: { preventDefault: () => void }) => {
      if (touch) e.preventDefault()
    },
  }
}

/** 길게 눌렀다: 들어 올린 상태로 바꾸고 손가락을 따라다닐 이름표를 만든다 */
function liftUp() {
  if (!touch) return
  touch.active = true
  navigator.vibrate?.(30)
  touch.el.classList.add('touch-lifted')
  document.body.classList.add('touch-dragging')
  window.getSelection()?.removeAllRanges()

  const ghost = document.createElement('div')
  ghost.className = 'touch-ghost'
  const count = touch.item.ids?.length ?? 1
  ghost.textContent = count > 1 ? `${touch.item.name} 외 ${count - 1}개` : touch.item.name
  document.body.appendChild(ghost)
  touch.ghost = ghost
  moveGhost(touch.startX, touch.startY)
  setDragging(true)
}

function moveGhost(x: number, y: number) {
  if (touch?.ghost) touch.ghost.style.transform = `translate(${x}px, ${y}px)`
}

function onTouchMove(e: TouchEvent) {
  if (!touch) return
  const t = e.touches[0]
  if (!touch.active) {
    if (Math.hypot(t.clientX - touch.startX, t.clientY - touch.startY) > MOVE_TOLERANCE) endTouch() // 스크롤하는 중
    return
  }
  e.preventDefault()
  moveGhost(t.clientX, t.clientY)

  // 손가락 밑에 있는 놓을 자리를 찾아 강조한다 (이름표는 pointer-events: none이라 밑의 요소가 잡힌다)
  const target = document.elementFromPoint(t.clientX, t.clientY)?.closest<HTMLElement>('[data-drop-folder]') ?? null
  if (target !== touch.over) {
    touch.over?.classList.remove('drop-over')
    target?.classList.add('drop-over')
    touch.over = target
  }

  // 화면 위/아래 끝으로 가면 스크롤해서 멀리 있는 폴더에도 놓을 수 있게
  const edge = 70
  if (t.clientY < edge) window.scrollBy(0, -12)
  else if (t.clientY > window.innerHeight - edge - 60) window.scrollBy(0, 12)
}

async function onTouchEnd(e: TouchEvent) {
  if (!touch) return
  const { active, over, item, refresh } = touch
  if (active) e.preventDefault() // 손을 뗄 때 파일이 열리지(click) 않게
  endTouch()
  if (!active || !over) return
  const raw = over.dataset.dropFolder
  const folderId = raw === 'root' || raw === undefined ? null : Number(raw)
  try {
    if (await moveDragged(item, folderId)) refresh()
  } catch (err) {
    alert((err as Error).message)
  }
}

/** 끌기를 끝내고 화면을 원래대로 돌린다 */
function endTouch() {
  if (!touch) return
  window.clearTimeout(touch.timer)
  touch.el.classList.remove('touch-lifted')
  touch.over?.classList.remove('drop-over')
  touch.ghost?.remove()
  document.body.classList.remove('touch-dragging')
  document.removeEventListener('touchmove', onTouchMove)
  document.removeEventListener('touchend', onTouchEnd)
  document.removeEventListener('touchcancel', endTouch)
  touch = null
  setDragging(false)
}
