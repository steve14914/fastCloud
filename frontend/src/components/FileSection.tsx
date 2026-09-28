import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Category } from '../api'
import { categoryLabels } from '../fileTypes'
import { useLoad } from '../hooks'
import { FileRow, PhotoTile } from './FileRow'
import { Icon } from './Icon'
import { PreviewModal } from './PreviewModal'

const emptyText: Record<Category, string> = {
  photo: '사진이 없어요.',
  document: '문서가 없어요.',
  other: '파일이 없어요.',
}

/** 메인 화면의 임시사진함 / 임시문서함 / 임시파일함 상자. 30일 뒤 자동으로 휴지통으로 간다. */
export function FileSection({ category }: { category: Category }) {
  const { data: files, error, reload } = useLoad(`home-${category}`, () =>
    api.listFiles({ view: 'home', category, limit: 50 }),
  )
  const [preview, setPreview] = useState<number | null>(null)

  return (
    <section className="card file-section">
      <div className="card-header">
        <div className="card-title">
          <h2>{categoryLabels[category]}</h2>
          <span className="expire-hint" title="올린 지 30일이 지나면 휴지통으로 가요. 남길 파일은 상자 버튼으로 영구저장소에 보내세요.">
            <Icon name="clock" size={13} /> 30일 뒤 자동삭제
          </span>
        </div>
        <div className="card-header-actions">
          <button className="icon-btn" onClick={reload} title="새로고침">
            <Icon name="refresh" />
          </button>
          <Link className="btn btn-ghost small" to={`/files?box=${category}`}>
            전체 보기
          </Link>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {files?.length === 0 && <p className="muted empty-small">{emptyText[category]}</p>}
      {category === 'photo' ? (
        <ul className="photo-grid scroll-list">
          {files?.map((f, i) => <PhotoTile key={f.id} file={f} mode="box" onOpen={() => setPreview(i)} />)}
        </ul>
      ) : (
        <ul className="file-list scroll-list">
          {files?.map((f, i) => <FileRow key={f.id} file={f} mode="box" onOpen={() => setPreview(i)} />)}
        </ul>
      )}
      {preview !== null && files && <PreviewModal files={files} index={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}
