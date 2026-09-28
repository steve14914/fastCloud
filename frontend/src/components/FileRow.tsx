import { useState } from 'react'
import { api, fileUrl, thumbUrl, type FileItem } from '../api'
import { categoryLabels, previewKind } from '../fileTypes'
import { formatBytes, formatDate } from '../format'
import { useRefresh } from '../refresh'
import { Icon } from './Icon'

/**
 * 파일 한 줄. 어디에 보여 주느냐(mode)에 따라 버튼이 달라진다.
 *  - box:     사진/문서/기타함 → 다운로드, 저장공간으로 보내기(stash), 삭제
 *  - storage: 저장공간(폴더) → 다운로드, 폴더 이동, 함으로 돌려놓기, 삭제
 *  - trash:   휴지통 → 되살리기, 완전 삭제
 */
export function FileRow({
  file,
  mode,
  onPreview,
  onMove,
  showThumb = file.category === 'photo' || mode === 'storage',
}: {
  file: FileItem
  mode: 'box' | 'storage' | 'trash'
  onPreview?: () => void
  onMove?: () => void
  showThumb?: boolean
}) {
  const { refresh } = useRefresh()
  const kind = previewKind(file)
  const canPreview = kind !== 'none' && onPreview !== undefined
  const [hidden, setHidden] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)

  // 버튼을 누르면 서버 응답을 기다리지 않고 바로 목록에서 숨긴다 (빠르게 느껴지도록).
  // 서버에서 실패하면 다시 보여 주고 알린다. 성공하면 다른 목록(용량 등)도 새로 불러온다.
  const act = (fn: () => Promise<unknown>, removesRow = true) => async () => {
    if (removesRow) setHidden(true)
    try {
      await fn()
      refresh()
    } catch (e) {
      setHidden(false)
      alert((e as Error).message)
    }
  }

  if (hidden) return null

  return (
    <li className="file-row">
      {showThumb && (
        <button className="thumb" onClick={onPreview} title="크게 보기" disabled={!onPreview}>
          {!thumbFailed && file.category === 'photo' ? (
            // loading="lazy": 화면에 보일 때만 불러온다. decoding="async": 그리는 동안 화면이 멈추지 않게
            <img src={thumbUrl(file.id)} alt="" loading="lazy" decoding="async" onError={() => setThumbFailed(true)} />
          ) : (
            <Icon name="file" size={24} />
          )}
        </button>
      )}
      <div className="file-info">
        {canPreview ? (
          <button className="file-name link-btn" onClick={onPreview} title="미리보기">
            {file.name}
          </button>
        ) : (
          <span className="file-name">{file.name}</span>
        )}
        <span className="muted small file-meta">
          {formatBytes(file.size)} · {formatDate(mode === 'trash' && file.deletedAt ? file.deletedAt : file.createdAt)}
          {mode === 'trash' && ' 삭제'}
        </span>
      </div>
      <div className="file-actions">
        {mode !== 'trash' && (
          <a className="square-btn" href={fileUrl(file.id)} download title="다운로드">
            <Icon name="download" />
          </a>
        )}
        {mode === 'box' && (
          <button
            className="square-btn"
            title="저장공간으로 보내기 (메인 화면에서 빠지고 전체 파일에서 폴더로 정리할 수 있어요)"
            onClick={act(() => api.updateFile(file.id, { stashed: true }))}
          >
            <Icon name="stash" />
          </button>
        )}
        {mode === 'storage' && (
          <>
            <button className="square-btn" title="폴더 이동" onClick={onMove}>
              <Icon name="move" />
            </button>
            <button
              className="square-btn"
              title={`${categoryLabels[file.category]}으로 돌려놓기`}
              onClick={act(() => api.updateFile(file.id, { stashed: false }))}
            >
              <Icon name="unstash" />
            </button>
          </>
        )}
        {mode !== 'trash' && (
          <button className="square-btn danger" title="삭제 (휴지통으로)" onClick={act(() => api.trashFile(file.id))}>
            <Icon name="trash" />
          </button>
        )}
        {mode === 'trash' && (
          <>
            <button className="square-btn" title="되살리기" onClick={act(() => api.restoreFile(file.id))}>
              <Icon name="restore" />
            </button>
            <button
              className="square-btn danger"
              title="완전히 삭제"
              onClick={() => {
                if (confirm(`"${file.name}"을(를) 완전히 삭제할까요? 되돌릴 수 없어요.`)) act(() => api.deleteForever(file.id))()
              }}
            >
              <Icon name="close" />
            </button>
          </>
        )}
      </div>
    </li>
  )
}
