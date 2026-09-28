import { useState } from 'react'
import { api } from '../api'
import { useRefresh } from '../refresh'
import { useSelection } from '../selection'
import { Icon } from './Icon'

/** 선택 모드일 때 화면 아래에 뜨는 막대: 몇 개 골랐는지, 여기로 이동 / 복사, 휴지통, 취소 */
export function SelectionBar() {
  const sel = useSelection()
  const { refresh } = useRefresh()
  const [busy, setBusy] = useState(false)
  if (!sel.active) return null

  const ids = [...sel.ids]
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      sel.stop()
      refresh()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const disabled = busy || ids.length === 0
  const here = sel.here

  return (
    <div className="selection-bar" role="toolbar">
      <div className="selection-info">
        <strong>{ids.length}개 선택</strong>
        <span className="muted small">
          {here ? `여기: ${here.label}` : '옮길 곳(폴더나 임시함)을 여세요'}
        </span>
      </div>
      <div className="selection-actions">
        <button className="btn small btn-primary" disabled={disabled || !here} onClick={() => here && run(() => api.moveFiles(ids, here.target))}>
          <Icon name="move" size={16} /> 여기로 이동
        </button>
        <button className="btn small" disabled={disabled || !here} onClick={() => here && run(() => api.copyFiles(ids, here.target))}>
          <Icon name="copy" size={16} /> 여기로 복사
        </button>
        <button
          className="btn small btn-danger-outline"
          disabled={disabled}
          title="고른 파일을 휴지통으로"
          onClick={() => {
            if (confirm(`고른 파일 ${ids.length}개를 휴지통으로 보낼까요?`))
              run(() => Promise.all(ids.map((id) => api.trashFile(id))))
          }}
        >
          <Icon name="trash" size={16} />
        </button>
        <button className="btn small btn-ghost" onClick={sel.stop} title="선택 취소">
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
