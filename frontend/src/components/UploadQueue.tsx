import { useEffect } from 'react'
import { formatBytes, formatSpeed } from '../format'
import { useUpload } from '../upload'
import { Icon } from './Icon'

/** 화면 아래쪽에 뜨는 업로드 진행 상황 */
export function UploadQueue() {
  const { items, clearFinished, cancel } = useUpload()
  const active = items.filter((it) => it.status === 'waiting' || it.status === 'uploading').length
  const failed = items.some((it) => it.status === 'error')

  // 모두 성공하면 3초 뒤 자동으로 닫는다 (실패한 게 있으면 확인할 수 있게 남겨 둔다)
  useEffect(() => {
    if (items.length === 0 || active > 0 || failed) return
    const t = window.setTimeout(clearFinished, 3000)
    return () => window.clearTimeout(t)
  }, [items.length, active, failed, clearFinished])

  if (items.length === 0) return null

  return (
    <div className="upload-queue">
      <div className="upload-queue-header">
        <strong>{active > 0 ? `올리는 중 (${active}개 남음)` : '업로드 완료'}</strong>
        {active < items.length && (
          <button className="link-btn" onClick={clearFinished}>
            완료 항목 지우기
          </button>
        )}
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.key} className={`upload-item upload-${it.status}`}>
            <div className="upload-item-top">
              <span className="ellipsis">{it.name}</span>
              <span className="muted small nowrap">
                {it.status === 'uploading' && `${formatBytes(it.loaded)} / ${formatBytes(it.size)} · ${formatSpeed(it.speed)}`}
                {it.status === 'waiting' && '대기 중'}
                {it.status === 'done' && '완료'}
                {it.status === 'error' && it.error}
              </span>
              {(it.status === 'waiting' || it.status === 'uploading') && (
                <button className="icon-btn small" onClick={() => cancel(it.key)} title="취소">
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${it.size ? (it.loaded / it.size) * 100 : it.status === 'done' ? 100 : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
