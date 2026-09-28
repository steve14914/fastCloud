import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useUpload, type UploadTarget } from '../upload'
import { Icon } from './Icon'
import { StatusBar } from './StatusBar'
import { UploadButton } from './UploadBox'
import { UploadQueue } from './UploadQueue'

/**
 * 로그인 후 모든 화면에 공통으로 들어가는 틀.
 *  - 화면 어디에 파일을 끌어다 놓아도 업로드
 *  - Ctrl+V로 파일/사진을 붙여넣으면 업로드
 *  - 폰에서는 오른쪽 아래에 업로드 버튼이 항상 떠 있음
 *  - 맨 아래 상태 표시줄 (용량, 속도, 로그아웃)
 */
export function Layout() {
  const { upload, target } = useUpload()
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0) // 자식 요소를 지날 때마다 dragenter/leave가 불려서 깊이를 센다

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault() // 이걸 해야 drop이 된다 (안 하면 브라우저가 파일을 열어 버림)
    }
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0
      setDragging(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer?.files.length) upload(e.dataTransfer.files, target)
    }
    // 붙여넣기: 클립보드에 파일(캡처한 사진 등)이 있을 때만 업로드. 글자는 원래대로 붙여넣어진다.
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        upload(namePastedFiles(files), target)
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [upload, target])

  return (
    <div className="layout">
      <main className="layout-main">
        <Outlet />
      </main>
      <UploadQueue />
      <div className="fab">
        <UploadButton target={target} className="fab-btn" label="" />
      </div>
      <StatusBar />
      {dragging && (
        <div className="drop-overlay">
          <Icon name="upload" size={48} />
          <p>놓으면 업로드돼요</p>
        </div>
      )}
    </div>
  )
}

/** 화면별로 "여기서 올리면 어디로 갈지" 정한다. */
export function useSetUploadTarget(t: UploadTarget) {
  const { setTarget } = useUpload()
  useEffect(() => {
    setTarget(t)
  }, [t, setTarget])
}

/**
 * 캡처 화면을 붙여넣으면 이름이 모두 "image.png"라서 구분이 안 된다.
 * 그런 경우 "붙여넣기 2026-09-28 14-05-33.png" 같은 이름을 붙여 준다.
 */
function namePastedFiles(files: FileList): File[] {
  const stamp = new Date().toLocaleString('sv-SE').replace(/:/g, '-') // 2026-09-28 14-05-33
  return Array.from(files).map((f, i) => {
    if (f.name && f.name !== 'image.png') return f
    const ext = f.type.split('/')[1] || 'png'
    const suffix = files.length > 1 ? ` (${i + 1})` : ''
    return new File([f], `붙여넣기 ${stamp}${suffix}.${ext}`, { type: f.type })
  })
}
