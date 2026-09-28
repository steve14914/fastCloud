// 화면 안에서 파일·폴더를 끌어다 폴더에 넣는 기능.
// 끌기 시작할 때 무엇을 끄는지 dataTransfer에 우리만 쓰는 형식으로 적어 두고, 폴더가 그걸 받는다.
// (컴퓨터의 파일을 끌어와 올리는 것과 구분하려고 Layout에서도 이 형식을 확인한다)

import { useState, type DragEvent } from 'react'
import { api } from './api'
import { useRefresh } from './refresh'

export const DND_TYPE = 'application/x-fastcloud-item'

export type DragItem = { kind: 'file' | 'folder'; id: number; name: string }

export function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'move'
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

/** 끌어 온 파일/폴더를 폴더 folderId(null이면 저장공간 맨 위)로 옮긴다. 옮길 게 없으면 false. */
export async function moveDragged(item: DragItem, folderId: number | null): Promise<boolean> {
  if (item.kind === 'file') {
    await api.updateFile(item.id, { folderId })
    return true
  }
  if (item.id === folderId) return false // 자기 자신에게 놓음
  await api.moveFolder(item.id, folderId)
  return true
}

/**
 * 폴더(또는 "저장공간 맨 위")를 놓을 자리로 만든다. 돌려준 props를 요소에 펼쳐 넣으면 된다.
 * over: 지금 그 위에 끌고 와 있는지 (강조 표시용)
 */
export function useDropTarget(folderId: number | null) {
  const { refresh } = useRefresh()
  const [over, setOver] = useState(false)
  const props = {
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
