import { useEffect, useState } from 'react'
import { api, type Usage } from '../api'
import { formatBytes, formatSpeed } from '../format'
import { useRefresh } from '../refresh'
import { useAuth } from '../auth'
import { Icon } from './Icon'

/** 화면 맨 아래: 사용 용량, 현재 다운로드/업로드 속도, 로그아웃 */
export function StatusBar() {
  const { version } = useRefresh()
  const { logout } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [speed, setSpeed] = useState({ uploadBps: 0, downloadBps: 0 })

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

  // fastcloud에 할당한 용량(기본 10GB) 중 얼마나 썼는지 보여 준다 (휴지통 포함). 할당이 없으면(0) 사용량만.
  const total = usage?.quotaBytes ?? 0
  const used = usage?.usedBytes ?? 0
  const ratio = total ? Math.min(used / total, 1) : 0

  return (
    <footer className="status-bar">
      <div
        className="status-usage"
        title={usage ? `파일 ${usage.fileCount}개, 그중 휴지통 ${formatBytes(usage.trashBytes)}` : ''}
      >
        <span className="small">
          {usage ? (
            <>
              사용 중 <strong>{formatBytes(used)}</strong>
              {total > 0 && (
                <span className="muted">
                  {' '}
                  / {formatBytes(total)} ({Math.round(ratio * 100)}%)
                </span>
              )}
            </>
          ) : (
            '용량 확인 중…'
          )}
        </span>
        {total > 0 && (
          <div className="progress">
            <div className={`progress-bar ${ratio > 0.9 ? 'progress-danger' : ''}`} style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
      </div>
      <div className="status-speed small">
        <span title="현재 다운로드 속도">↓ {formatSpeed(speed.downloadBps)}</span>
        <span title="현재 업로드 속도">↑ {formatSpeed(speed.uploadBps)}</span>
      </div>
      <button className="btn btn-ghost small" onClick={logout}>
        <Icon name="logout" size={16} /> 로그아웃
      </button>
    </footer>
  )
}
