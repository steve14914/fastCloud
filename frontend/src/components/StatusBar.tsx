import { useEffect, useState } from 'react'
import { api, type Usage } from '../api'
import { formatBytes, formatSpeed } from '../format'
import { useRefresh } from '../refresh'
import { useAuth } from '../auth'
import { Icon } from './Icon'
import { InfoModal } from './InfoModal'

/** 화면 맨 아래: 설명(info), 사용 용량, 현재 다운로드/업로드 속도, 로그아웃 */
export function StatusBar() {
  const { version } = useRefresh()
  const { logout } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [speed, setSpeed] = useState({ uploadBps: 0, downloadBps: 0 })
  const [showInfo, setShowInfo] = useState(false)

  // 용량: 파일이 바뀔 때마다 다시 불러온다
  useEffect(() => {
    api.usage().then(setUsage).catch(() => {})
  }, [version])

  // 속도: 화면이 보이는 동안 1초마다 서버에 물어본다 (다른 기기에서 주고받는 것도 포함)
  useEffect(() => {
    let timer: number | undefined
    const tick = () => {
      if (document.visibilityState === 'visible') {
        api.transferStats().then(setSpeed).catch(() => {})
      }
    }
    tick()
    timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <footer className="status-bar">
      <button className="btn btn-ghost small info-btn" onClick={() => setShowInfo(true)} title="이 사이트 사용법과 자동 삭제 규칙">
        <Icon name="info" size={16} /> info
      </button>
      <UsageMeter usage={usage} />
      <div className="status-speed small">
        <span title="현재 다운로드 속도">↓ {formatSpeed(speed.downloadBps)}</span>
        <span title="현재 업로드 속도">↑ {formatSpeed(speed.uploadBps)}</span>
      </div>
      <button className="btn btn-ghost small" onClick={logout} title="로그아웃">
        <Icon name="logout" size={16} /> <span className="hide-mobile">로그아웃</span>
      </button>
      {showInfo && <InfoModal usage={usage} onClose={() => setShowInfo(false)} />}
    </footer>
  )
}

/**
 * 할당 용량(기본 10GB) 막대: [보통 파일 | 휴지통(회색 빗금) | 남은 용량] 순서.
 * 휴지통까지 합쳐 80% 넘으면 노란색, 90% 넘으면 빨간색. 할당이 없으면(0) 사용량 글자만.
 */
function UsageMeter({ usage }: { usage: Usage | null }) {
  if (!usage) return <div className="status-usage small">용량 확인 중…</div>
  const total = usage.quotaBytes
  const used = usage.usedBytes
  const trash = usage.trashBytes
  const ratio = total ? Math.min(used / total, 1) : 0
  const level = ratio >= 0.9 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok'
  const pct = (n: number) => `${total ? Math.min((n / total) * 100, 100) : 0}%`

  return (
    <div
      className="status-usage"
      title={`파일 ${usage.fileCount}개 · 보통 파일 ${formatBytes(used - trash)} · 휴지통 ${formatBytes(trash)}${
        total ? ` · 남은 용량 ${formatBytes(Math.max(total - used, 0))}` : ''
      }`}
    >
      <span className="small">
        사용 중 <strong className={`usage-${level}`}>{formatBytes(used)}</strong>
        {total > 0 && (
          <span className="muted">
            {' '}
            / {formatBytes(total)} ({Math.round(ratio * 100)}%)
          </span>
        )}
        {trash > 0 && <span className="muted"> · 휴지통 {formatBytes(trash)}</span>}
      </span>
      {total > 0 && (
        <div className="usage-bar">
          <div className={`usage-files usage-${level}`} style={{ width: pct(used - trash) }} />
          <div className="usage-trash" style={{ width: pct(trash) }} />
        </div>
      )}
    </div>
  )
}
