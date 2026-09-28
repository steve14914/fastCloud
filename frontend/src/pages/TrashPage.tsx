import { Link } from 'react-router-dom'
import { api } from '../api'
import { FileRow } from '../components/FileRow'
import { Icon } from '../components/Icon'
import { formatBytes } from '../format'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'

export function TrashPage() {
  const { refresh } = useRefresh()
  const { data: files, error } = useLoad('trash', () => api.listFiles({ view: 'trash' }))
  const total = files?.reduce((sum, f) => sum + f.size, 0) ?? 0

  const empty = async () => {
    if (!confirm('휴지통의 파일을 모두 완전히 삭제할까요? 되돌릴 수 없어요.')) return
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
          <span className="muted small">
            {files ? `${files.length}개 · ${formatBytes(total)}` : ''} · 30일이 지나면 자동으로 완전히 지워져요
          </span>
          <div className="card-header-actions">
            <button className="btn btn-ghost small danger" onClick={empty} disabled={!files?.length}>
              휴지통 비우기
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {files?.length === 0 && <p className="muted empty-small">휴지통이 비어 있어요.</p>}
        <ul className="file-list">
          {files?.map((f) => <FileRow key={f.id} file={f} mode="trash" />)}
        </ul>
      </section>
    </div>
  )
}
