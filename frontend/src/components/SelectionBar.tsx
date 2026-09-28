import { useState } from 'react'
import { api, type Folder } from '../api'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'
import { splitKeys, useSelection } from '../selection'
import { Icon } from './Icon'

/**
 * 선택 기능의 아래쪽 막대.
 *  - 고르는 중:        N개 선택 · [이동] [복사] [휴지통] [취소]
 *  - 옮길 곳 고르는 중: N개를 옮길 곳으로 가서 완료 · 여기: ○○ · [완료] [취소]
 */
export function SelectionBar() {
  const sel = useSelection()
  const { refresh } = useRefresh()
  const [busy, setBusy] = useState(false)
  const { data: allFolders } = useLoad('folders', () => api.listFolders())
  if (sel.phase === 'off') return null

  const { files, folders } = splitKeys(sel.keys)
  const count = files.length + folders.length
  const summary = folders.length ? `${count}개 (폴더 ${folders.length}개)` : `${count}개`

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

  if (sel.phase === 'select') {
    return (
      <div className="selection-bar" role="toolbar">
        <div className="selection-info">
          <strong>{summary} 선택</strong>
          <span className="muted small">Ctrl+클릭: 하나씩 · Shift+클릭: 범위</span>
        </div>
        <div className="selection-actions">
          <button className="btn small btn-primary" disabled={!count} onClick={() => sel.beginTransfer('move')}>
            <Icon name="move" size={16} /> 이동
          </button>
          <button className="btn small" disabled={!count} onClick={() => sel.beginTransfer('copy')}>
            <Icon name="copy" size={16} /> 복사
          </button>
          <button
            className="btn small btn-danger-outline"
            disabled={busy || !files.length || folders.length > 0}
            title={folders.length ? '폴더가 섞여 있으면 휴지통으로 보낼 수 없어요' : '고른 파일을 휴지통으로'}
            onClick={() => {
              if (confirm(`고른 파일 ${files.length}개를 휴지통으로 보낼까요?`))
                run(() => Promise.all(files.map((id) => api.trashFile(id))))
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

  // 옮길(복사할) 곳을 고르는 중
  const moving = sel.phase === 'move'
  const verb = moving ? '이동' : '복사'
  const here = sel.here
  let problem = ''
  if (!here) problem = '영구저장소나 임시함 전체 보기로 가세요'
  else if (moving && here.key === sel.originKey) problem = '원래 있던 곳이에요. 다른 경로로 가세요'
  else if ('box' in here.target && folders.length) problem = '폴더는 임시함에 넣을 수 없어요'
  else if ('folderId' in here.target && isInsideAny(here.target.folderId, folders, allFolders ?? []))
    problem = '고른 폴더 안으로는 옮기거나 복사할 수 없어요'

  return (
    <div className="selection-bar transfer" role="toolbar">
      <div className="selection-info">
        <strong>
          {summary} {verb}할 곳으로 가서 완료를 누르세요
        </strong>
        <span className={`small ${problem ? 'error-text' : 'muted'}`}>{problem || `여기: ${here!.label}`}</span>
      </div>
      <div className="selection-actions">
        <button
          className="btn small btn-primary"
          disabled={busy || !!problem}
          onClick={() =>
            here && run(() => (moving ? api.moveFiles : api.copyFiles)(files, here.target, folders))
          }
        >
          <Icon name="check" size={16} /> 여기로 {verb} 완료
        </button>
        <button className="btn small btn-ghost" onClick={sel.stop} title={`${verb} 취소`}>
          <Icon name="close" size={16} /> 취소
        </button>
      </div>
    </div>
  )
}

/** folderId가 고른 폴더들 중 하나이거나 그 하위 폴더이면 true */
function isInsideAny(folderId: number | null, picked: number[], all: Folder[]) {
  let cur = folderId
  while (cur !== null) {
    if (picked.includes(cur)) return true
    cur = all.find((f) => f.id === cur)?.parentId ?? null
  }
  return false
}
