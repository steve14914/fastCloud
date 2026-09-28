import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Category, type FileItem, type Folder } from '../api'
import { FileRow } from '../components/FileRow'
import { FolderPicker } from '../components/FolderPicker'
import { Icon } from '../components/Icon'
import { useSetUploadTarget } from '../components/Layout'
import { PreviewModal } from '../components/PreviewModal'
import { UploadBox, UploadButton } from '../components/UploadBox'
import { categoryLabels } from '../fileTypes'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'

const categories: Category[] = ['photo', 'document', 'other']

/**
 * 전체 파일함.
 *   /files             맨 위: 사진함·문서함·기타파일함 + 저장공간의 폴더와 파일
 *   /files?box=photo   사진함 안
 *   /files?folder=3    저장공간의 폴더 안
 */
export function FilesPage() {
  const [params] = useSearchParams()
  const box = params.get('box') as Category | null
  const folderParam = params.get('folder')
  const folderId = folderParam ? Number(folderParam) : null

  const { data: folders } = useLoad('folders', () => api.listFolders())

  // 폴더 안에서 올리면 그 폴더로, 그 밖(맨 위, 사진함 등)에서는 사진/문서/기타함으로
  useSetUploadTarget(folderId ?? undefined)

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb box={box} folderId={folderId} folders={folders ?? []} />
        <div className="page-header-actions">
          <Link className="btn btn-ghost" to="/trash">
            <Icon name="trash" /> <span className="hide-mobile">휴지통</span>
          </Link>
          <Link className="btn btn-ghost" to="/">
            <Icon name="back" /> <span className="hide-mobile">메인으로</span>
          </Link>
        </div>
      </header>

      {box ? <BoxView category={box} /> : <StorageView folderId={folderId} folders={folders ?? []} />}

      <div className="page-upload">
        <UploadBox
          target={folderId ?? undefined}
          hint={folderId ? '이 폴더에 올라가요' : '종류에 따라 사진함 · 문서함 · 기타파일함으로 들어가요'}
        />
        <UploadButton target={folderId ?? undefined} />
      </div>
    </div>
  )
}

/** 맨 위 > 폴더 > 하위 폴더 경로 표시 */
function Breadcrumb({ box, folderId, folders }: { box: Category | null; folderId: number | null; folders: Folder[] }) {
  const path: Folder[] = []
  let cur = folders.find((f) => f.id === folderId)
  while (cur) {
    path.unshift(cur)
    cur = folders.find((f) => f.id === cur!.parentId)
  }
  const atRoot = !box && folderId === null
  return (
    <nav className="breadcrumb">
      {atRoot ? <h1>전체 파일</h1> : <Link to="/files">전체 파일</Link>}
      {box && (
        <>
          <span className="muted">/</span>
          <h1>{categoryLabels[box]}</h1>
        </>
      )}
      {path.map((f, i) => (
        <span key={f.id} className="breadcrumb-part">
          <span className="muted">/</span>
          {i === path.length - 1 ? <h1>{f.name}</h1> : <Link to={`/files?folder=${f.id}`}>{f.name}</Link>}
        </span>
      ))}
    </nav>
  )
}

/** 사진함 / 문서함 / 기타파일함 안 */
function BoxView({ category }: { category: Category }) {
  const { data: files, error } = useLoad(`box-${category}`, () => api.listFiles({ view: 'home', category }))
  return (
    <section className="card">
      <p className="muted small">
        상자 버튼을 누르면 저장공간으로 보내져 메인 화면에서 빠지고, 전체 파일에서 폴더로 정리할 수 있어요.
      </p>
      <FileList files={files} error={error} mode="box" empty="파일이 없어요." />
    </section>
  )
}

/** 저장공간: 맨 위 또는 폴더 안 */
function StorageView({ folderId, folders }: { folderId: number | null; folders: Folder[] }) {
  const { refresh } = useRefresh()
  const { data: files, error } = useLoad(`folder-${folderId ?? 'root'}`, () =>
    api.listFiles(folderId === null ? { view: 'stash', folder: 'root' } : { view: 'all', folder: folderId }),
  )
  const subfolders = folders.filter((f) => f.parentId === folderId)
  const [movingFolder, setMovingFolder] = useState<Folder | null>(null)

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      refresh()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const newFolder = () => {
    const name = prompt('새 폴더 이름')
    if (name?.trim()) act(() => api.createFolder(name.trim(), folderId))
  }

  return (
    <>
      {folderId === null && <BoxCards />}

      <section className="card">
        <div className="card-header">
          <h2>{folderId === null ? '저장공간' : '폴더 내용'}</h2>
          <div className="card-header-actions">
            <button className="btn btn-ghost small" onClick={newFolder}>
              <Icon name="folderPlus" size={16} /> 새 폴더
            </button>
          </div>
        </div>
        {folderId === null && (
          <p className="muted small">메인 화면에서 상자 버튼(저장공간으로 보내기)을 누른 파일이 여기로 와요.</p>
        )}

        {subfolders.length > 0 && (
          <ul className="file-list">
            {subfolders.map((f) => (
              <li key={f.id} className="file-row">
                <Link className="thumb folder-thumb" to={`/files?folder=${f.id}`}>
                  <Icon name="folder" size={24} />
                </Link>
                <div className="file-info">
                  <Link className="file-name" to={`/files?folder=${f.id}`}>
                    {f.name}
                  </Link>
                </div>
                <div className="file-actions">
                  <button
                    className="square-btn"
                    title="이름 바꾸기"
                    onClick={() => {
                      const name = prompt('새 이름', f.name)
                      if (name?.trim()) act(() => api.renameFolder(f.id, name.trim()))
                    }}
                  >
                    <Icon name="edit" />
                  </button>
                  <button className="square-btn" title="폴더 이동" onClick={() => setMovingFolder(f)}>
                    <Icon name="move" />
                  </button>
                  <button
                    className="square-btn danger"
                    title="폴더 삭제 (안의 파일은 한 칸 위로 나와요)"
                    onClick={() => {
                      if (confirm(`"${f.name}" 폴더를 지울까요? 안에 있던 파일과 폴더는 한 칸 위로 옮겨져요.`))
                        act(() => api.deleteFolder(f.id))
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <FileList
          files={files}
          error={error}
          mode="storage"
          folders={folders}
          empty={subfolders.length ? '' : '비어 있어요.'}
        />
      </section>

      {movingFolder && (
        <FolderPicker
          title={`"${movingFolder.name}" 폴더를 어디로 옮길까요?`}
          folders={folders}
          exclude={movingFolder.id}
          onClose={() => setMovingFolder(null)}
          onPick={(parentId) => {
            setMovingFolder(null)
            act(() => api.moveFolder(movingFolder.id, parentId))
          }}
        />
      )}
    </>
  )
}

/** 맨 위에 보이는 사진함 · 문서함 · 기타파일함 카드 (파일 개수 포함) */
function BoxCards() {
  const { data: files } = useLoad('home-all', () => api.listFiles({ view: 'home' }))
  return (
    <div className="box-cards">
      {categories.map((c) => (
        <Link key={c} to={`/files?box=${c}`} className="card box-card">
          <Icon name="stash" size={24} />
          <strong>{categoryLabels[c]}</strong>
          <span className="muted small">{files ? `${files.filter((f) => f.category === c).length}개` : '…'}</span>
        </Link>
      ))}
    </div>
  )
}

/** 파일 목록 + 미리보기 + 폴더 이동 창 */
function FileList({
  files,
  error,
  mode,
  folders = [],
  empty,
}: {
  files: FileItem[] | null
  error: string
  mode: 'box' | 'storage'
  folders?: Folder[]
  empty: string
}) {
  const { refresh } = useRefresh()
  const [preview, setPreview] = useState<number | null>(null)
  const [moving, setMoving] = useState<FileItem | null>(null)

  return (
    <>
      {error && <p className="error">{error}</p>}
      {files === null && <p className="muted">불러오는 중…</p>}
      {files?.length === 0 && empty && <p className="muted empty-small">{empty}</p>}
      <ul className="file-list">
        {files?.map((f, i) => (
          <FileRow key={f.id} file={f} mode={mode} onPreview={() => setPreview(i)} onMove={() => setMoving(f)} />
        ))}
      </ul>
      {preview !== null && files && <PreviewModal files={files} index={preview} onClose={() => setPreview(null)} />}
      {moving && (
        <FolderPicker
          title={`"${moving.name}"을(를) 어디로 옮길까요?`}
          folders={folders}
          onClose={() => setMoving(null)}
          onPick={async (folderId) => {
            setMoving(null)
            try {
              await api.updateFile(moving.id, { folderId })
              refresh()
            } catch (e) {
              alert((e as Error).message)
            }
          }}
        />
      )}
    </>
  )
}
