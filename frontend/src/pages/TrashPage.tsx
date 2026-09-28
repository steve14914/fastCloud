import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type FileItem } from '../api'
import { Thumb } from '../components/FileRow'
import { Icon } from '../components/Icon'
import { formatBytes } from '../format'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'

/** 휴지통: 가장 최근에 지운 파일이 위에. 파일마다 복구 / 영구삭제, 위쪽에 전체 영구삭제. */
export function TrashPage() {
  const { refresh } = useRefresh()
  const { data: files, error } = useLoad('trash', () => api.listFiles({ view: 'trash' }))
  const total = files?.reduce((sum, f) => sum + f.size, 0) ?? 0

  const emptyAll = async () => {
    if (!confirm(`휴지통의 파일 ${files?.length ?? 0}개를 모두 영구삭제할까요?\n되돌릴 수 없어요.`)) return
    try {
      await api.emptyTrash()
      refresh()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <nav className="breadcrumb">
          <Link to="/files">전체 파일</Link>
          <span className="muted">/</span>
          <h1>휴지통</h1>
        </nav>
        <div className="page-header-actions">
          <Link className="btn btn-ghost" to="/">
            <Icon name="back" /> <span className="hide-mobile">메인으로</span>
          </Link>
        </div>
      </header>
      <section className="card">
        <div className="card-header">
          <span className="muted small">{files ? `${files.length}개 · ${formatBytes(total)}` : ''}</span>
          <div className="card-header-actions">
            <button className="btn small btn-danger" onClick={emptyAll} disabled={!files?.length}>
              <Icon name="trash" size={16} /> 전체 영구삭제
            </button>
          </div>
        </div>
        <p className="trash-notice">
          <Icon name="clock" size={16} /> 휴지통의 파일은 30일 뒤에 자동으로 삭제됩니다.
        </p>
        {error && <p className="error">{error}</p>}
        {files?.length === 0 && <p className="muted empty-small">휴지통이 비어 있어요.</p>}
        <ul className="file-list">{files?.map((f) => <TrashRow key={f.id} file={f} />)}</ul>
      </section>
    </div>
  )
}

/** 휴지통의 파일 한 줄: 사진은 미리보기 + 이름, 나머지는 이름만. 오른쪽에 복구, 영구삭제. */
function TrashRow({ file }: { file: FileItem }) {
  const { refresh } = useRefresh()
  const [hidden, setHidden] = useState(false)

  // 누르면 바로 목록에서 빼고, 실패하면 되돌린다
  const act = async (fn: () => Promise<unknown>) => {
    setHidden(true)
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
      {file.category === 'photo' && <Thumb file={file} />}
      <span className="file-name trash-name" title={file.name}>
        {file.name}
      </span>
      <div className="file-actions">
        <button className="btn small" onClick={() => act(() => api.restoreFile(file.id))} title="원래 있던 곳으로 되살리기">
          <Icon name="restore" size={16} /> 복구
        </button>
        <button
          className="btn small btn-danger-outline"
          title="영구삭제"
          onClick={() => {
            if (confirm(`"${file.name}"을(를) 영구삭제할까요?\n되돌릴 수 없어요.`)) act(() => api.deleteForever(file.id))
          }}
        >
          <Icon name="close" size={16} /> 영구삭제
        </button>
      </div>
    </li>
  )
}
