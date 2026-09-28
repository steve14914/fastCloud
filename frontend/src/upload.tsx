// 업로드 대기열. 어느 화면에서든 upload(files)를 부르면 여기서 하나씩 차례로 올린다.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { uploadFile } from './api'
import { useRefresh } from './refresh'

/** 올릴 곳. undefined: 사진/문서/기타함 (종류는 서버가 확장자로 정함), 'root': 저장공간 맨 위, 숫자: 그 폴더 */
export type UploadTarget = number | 'root' | undefined

export interface UploadItem {
  key: number
  name: string
  size: number
  loaded: number
  speed: number // 이 파일의 현재 업로드 속도 (바이트/초)
  status: 'waiting' | 'uploading' | 'done' | 'error'
  error?: string
}

interface UploadContextValue {
  items: UploadItem[]
  upload: (files: FileList | File[], target?: UploadTarget) => void
  clearFinished: () => void
  cancel: (key: number) => void
  /** 현재 화면이 기본으로 올릴 곳 (폴더 화면이면 그 폴더). 드래그앤드롭과 붙여넣기에 쓰인다. */
  target: UploadTarget
  setTarget: (t: UploadTarget) => void
}

const UploadContext = createContext<UploadContextValue | null>(null)

let nextKey = 1

export function UploadProvider({ children }: { children: ReactNode }) {
  const { refresh } = useRefresh()
  const [items, setItems] = useState<UploadItem[]>([])
  const [target, setTarget] = useState<UploadTarget>(undefined)
  // 대기 중인 작업들. 화면을 다시 그릴 필요가 없는 값이라 state가 아니라 ref에 둔다.
  const queue = useRef<{ key: number; file: File; target: UploadTarget }[]>([])
  const running = useRef(false)
  const cancelCurrent = useRef<{ key: number; cancel: () => void } | null>(null)

  const update = (key: number, changes: Partial<UploadItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...changes } : it)))

  // 대기열이 빌 때까지 하나씩 올린다 (동시에 여러 개를 올리면 오히려 느려지고 진행률도 보기 어렵다).
  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    while (queue.current.length > 0) {
      const job = queue.current.shift()!
      update(job.key, { status: 'uploading' })
      let last = { time: performance.now(), loaded: 0 }
      const { promise, cancel } = uploadFile(job.file, job.target, (loaded) => {
        const now = performance.now()
        const dt = (now - last.time) / 1000
        if (dt >= 0.5) {
          update(job.key, { loaded, speed: (loaded - last.loaded) / dt })
          last = { time: now, loaded }
        }
      })
      cancelCurrent.current = { key: job.key, cancel }
      try {
        await promise
        update(job.key, { status: 'done', loaded: job.file.size, speed: 0 })
        refresh()
      } catch (e) {
        update(job.key, { status: 'error', error: (e as Error).message, speed: 0 })
      }
      cancelCurrent.current = null
    }
    running.current = false
  }, [refresh])

  const upload = useCallback(
    (files: FileList | File[], t?: UploadTarget) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const newItems = list.map((file) => {
        const key = nextKey++
        queue.current.push({ key, file, target: t })
        return { key, name: file.name, size: file.size, loaded: 0, speed: 0, status: 'waiting' as const }
      })
      setItems((prev) => [...prev, ...newItems])
      run()
    },
    [run],
  )

  const cancel = useCallback((key: number) => {
    queue.current = queue.current.filter((j) => j.key !== key)
    if (cancelCurrent.current?.key === key) cancelCurrent.current.cancel()
    setItems((list) => list.filter((it) => it.key !== key || it.status === 'uploading'))
  }, [])

  const clearFinished = useCallback(
    () => setItems((list) => list.filter((it) => it.status === 'waiting' || it.status === 'uploading')),
    [],
  )

  return (
    <UploadContext.Provider value={{ items, upload, clearFinished, cancel, target, setTarget }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('UploadProvider 안에서만 쓸 수 있습니다')
  return ctx
}
