import { useEffect, useRef, useState } from 'react'
import { fileUrl, readTextPreview, type FileItem } from '../api'
import { previewKind } from '../fileTypes'
import { formatBytes } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

/**
 * 파일 미리보기 창. 사진은 크게, PDF는 브라우저 PDF 뷰어로, 텍스트 파일은 글자로 보여 준다.
 * files와 index를 주면 사진처럼 좌우로 넘겨 볼 수 있다.
 */
export function PreviewModal({ files, index, onClose }: { files: FileItem[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  const file = files[i]
  const kind = previewKind(file)
  const hasPrev = i > 0
  const hasNext = i < files.length - 1
  const touchX = useRef(0)

  // 앞뒤 사진을 미리 받아 두어 넘길 때 바로 보이게 한다 (서버가 캐시를 허용해서 다시 받지 않는다)
  useEffect(() => {
    for (const j of [i - 1, i + 1]) {
      const f = files[j]
      if (f && previewKind(f) === 'image') new Image().src = fileUrl(f.id, true)
    }
  }, [i, files])

  // 키보드 ←/→ 로 넘기기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) setI(i - 1)
      if (e.key === 'ArrowRight' && hasNext) setI(i + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, hasPrev, hasNext])

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        <div className="preview-title">
          <span className="ellipsis">{file.name}</span>
          <span className="muted small nowrap">{formatBytes(file.size)}</span>
          <a className="icon-btn" href={fileUrl(file.id)} download title="다운로드">
            <Icon name="download" />
          </a>
        </div>
      }
    >
      <div
        className="preview"
        // 폰에서 좌우로 밀어서 넘기기
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touchX.current
          if (dx > 60 && hasPrev) setI(i - 1)
          if (dx < -60 && hasNext) setI(i + 1)
        }}
      >
        {kind === 'image' && <img key={file.id} className="preview-image" src={fileUrl(file.id, true)} alt={file.name} />}
        {kind === 'pdf' && <iframe className="preview-frame" src={fileUrl(file.id, true)} title={file.name} />}
        {kind === 'video' && <video className="preview-image" src={fileUrl(file.id, true)} controls autoPlay />}
        {kind === 'audio' && <audio src={fileUrl(file.id, true)} controls autoPlay />}
        {kind === 'text' && <TextPreview key={file.id} id={file.id} />}
        {kind === 'none' && (
          <div className="empty">
            <p>이 형식은 미리보기를 지원하지 않아요.</p>
            <a className="btn btn-primary" href={fileUrl(file.id)} download>
              <Icon name="download" /> 다운로드
            </a>
          </div>
        )}
        {files.length > 1 && (
          <>
            {hasPrev && (
              <button className="preview-nav preview-prev" onClick={() => setI(i - 1)} title="이전">
                <Icon name="chevronLeft" size={28} />
              </button>
            )}
            {hasNext && (
              <button className="preview-nav preview-next" onClick={() => setI(i + 1)} title="다음">
                <Icon name="chevronRight" size={28} />
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function TextPreview({ id }: { id: number }) {
  const [state, setState] = useState<{ text?: string; truncated?: boolean; error?: string }>({})
  useEffect(() => {
    readTextPreview(id)
      .then((r) => setState(r))
      .catch((e) => setState({ error: e.message }))
  }, [id])

  if (state.error) return <p className="error">{state.error}</p>
  if (state.text === undefined) return <p className="muted">불러오는 중…</p>
  return (
    <div className="preview-text-wrap">
      <pre className="preview-text">{state.text}</pre>
      {state.truncated && <p className="muted small">파일이 커서 앞부분(512KB)만 보여 줘요. 전체는 다운로드해서 보세요.</p>}
    </div>
  )
}
