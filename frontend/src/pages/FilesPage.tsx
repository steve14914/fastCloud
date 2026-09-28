import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Category, type FileItem, type Folder } from '../api'
import { FileRow, PhotoTile } from '../components/FileRow'
import { FolderPicker } from '../components/FolderPicker'
import { Icon } from '../components/Icon'
import { useSetUploadTarget } from '../components/Layout'
import { PreviewModal } from '../components/PreviewModal'
import { UploadBox, UploadButton } from '../components/UploadBox'
import { startDrag, useDropTarget, useIsDragging, useTouchDrag } from '../dnd'
import { categoryLabels } from '../fileTypes'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'
import { useSelection, useSetSelectionHere } from '../selection'
import type { UploadTarget } from '../upload'

/**
 * 영구저장소와 임시함 전체 보기.
 *   /files             영구저장소 맨 위: 폴더와 파일 (자동으로 지워지지 않음)
 *   /files?folder=3    영구저장소의 폴더 안
 *   /files?box=photo   임시사진함 전체 보기 (30일 뒤 자동삭제)
 */
export function FilesPage() {
  const [params] = useSearchParams()
  const box = params.get('box') as Category | null
  const folderParam = params.get('folder')
  const folderId = folderParam ? Number(folderParam) : null
  const sel = useSelection()

  const { data: folders } = useLoad('folders', () => api.listFolders())
  const current = folders?.find((f) => f.id === folderId)

  // 임시함 화면에서 올리면 임시함으로, 영구저장소에서는 보고 있는 폴더(또는 맨 위)로
  const uploadTarget: UploadTarget = box ? undefined : (folderId ?? 'root')
  useSetUploadTarget(uploadTarget)

  // 선택 모드의 "여기로 이동/복사"
  useSetSelectionHere(
    box
      ? { target: { box: true }, label: '임시함' }
      : { target: { folderId }, label: folderId === null ? '영구저장소 맨 위' : `'${current?.name ?? '폴더'}' 폴더` },
  )

  return (
    <div className="page">
      <header className="page-header">
        <Breadcrumb box={box} folderId={folderId} folders={folders ?? []} />
        <div className="page-header-actions">
          <button
            className={`btn ${sel.active ? 'btn-primary' : 'btn-ghost'}`}
            onClick={sel.active ? sel.stop : sel.start}
            title="파일 여러 개를 골라 옮기거나 복사하기"
          >
            <Icon name="checklist" /> {sel.active ? '선택 끝' : '선택'}
          </button>
          {box && (
            <Link className="btn btn-ghost" to="/files">
              <Icon name="folder" /> <span className="hide-mobile">영구저장소</span>
            </Link>
          )}
          <Link className="btn btn-ghost" to="/trash">
            <Icon name="trash" /> <span className="hide-mobile">휴지통</span>
          </Link>
          <Link className="btn btn-ghost" to="/">
            <Icon name="back" /> <span className="hide-mobile">메인으로</span>
          </Link>
        </div>
      </header>

      {box ? <BoxView category={box} /> : <StorageView folderId={folderId} folders={folders ?? []} />}

      {folderId !== null && current && <ParentDropZone parentId={current.parentId} />}

      <div className="page-upload">
        <UploadBox
          target={uploadTarget}
          hint={
            box
              ? '종류에 따라 임시사진함 · 임시문서함 · 임시파일함으로 들어가요 (30일 뒤 자동삭제)'
              : folderId
                ? '이 폴더에 올라가요 (자동으로 지워지지 않아요)'
                : '영구저장소 맨 위에 올라가요 (자동으로 지워지지 않아요)'
          }
        />
        <UploadButton target={uploadTarget} />
      </div>
    </div>
  )
}

/** 끄는 동안 화면 위쪽에 뜨는 "상위 폴더로 이동" 칸 */
function ParentDropZone({ parentId }: { parentId: number | null }) {
  const dragging = useIsDragging()
  const { over, props } = useDropTarget(parentId)
  if (!dragging) return null
  return (
    <div className={`parent-drop ${over ? 'drop-over' : ''}`} {...props}>
      <Icon name="up" size={20} /> 상위 폴더로 이동
    </div>
  )
}

/** 영구저장소 > 폴더 > 하위 폴더 경로 표시 (임시함은 메인 > 임시사진함) */
function Breadcrumb({ box, folderId, folders }: { box: Category | null; folderId: number | null; folders: Folder[] }) {
  const path: Folder[] = []
  let cur = folders.find((f) => f.id === folderId)
  while (cur) {
    path.unshift(cur)
    cur = folders.find((f) => f.id === cur!.parentId)
  }
  if (box) {
    return (
      <nav className="breadcrumb">
        <Link to="/">메인</Link>
        <span className="muted">/</span>
        <h1>{categoryLabels[box]}</h1>
      </nav>
    )
  }
  const atRoot = folderId === null
  return (
    <nav className="breadcrumb">
      {atRoot ? (
        <h1>영구저장소</h1>
      ) : (
        <CrumbLink to="/files" folderId={null}>
          영구저장소
        </CrumbLink>
      )}
      {path.map((f, i) => (
        <span key={f.id} className="breadcrumb-part">
          <span className="muted">/</span>
          {i === path.length - 1 ? (
            <h1>{f.name}</h1>
          ) : (
            <CrumbLink to={`/files?folder=${f.id}`} folderId={f.id}>
              {f.name}
            </CrumbLink>
          )}
        </span>
      ))}
    </nav>
  )
}

type PhotoView = 'grid' | 'list'

/** 임시사진함에서 고른 보기 방식 (기기마다 기억) */
function usePhotoView(): [PhotoView, (v: PhotoView) => void] {
  const [view, setView] = useState<PhotoView>(() => (localStorage.getItem('photoView') === 'list' ? 'list' : 'grid'))
  return [
    view,
    (v) => {
      localStorage.setItem('photoView', v)
      setView(v)
    },
  ]
}

/** 임시사진함 / 임시문서함 / 임시파일함 전체 보기 */
function BoxView({ category }: { category: Category }) {
  const { data: files, error } = useLoad(`box-${category}`, () => api.listFiles({ view: 'home', category }))
  const [photoView, setPhotoView] = usePhotoView()
  const isPhoto = category === 'photo'
  return (
    <section className="card">
      <div className="box-view-top">
        <p className="expire-warning">
          <Icon name="clock" size={16} />
          <span>
            <strong>30일 뒤 자동으로 삭제돼요.</strong> 남길 파일은 상자 버튼을 눌러 영구저장소로 보내세요.
          </span>
        </p>
        {isPhoto && (
          <div className="view-toggle" role="group" aria-label="보기 방식">
            <button
              className={photoView === 'grid' ? 'on' : ''}
              onClick={() => setPhotoView('grid')}
              title="큰 미리보기로 보기"
            >
              <Icon name="grid" size={16} />
            </button>
            <button
              className={photoView === 'list' ? 'on' : ''}
              onClick={() => setPhotoView('list')}
              title="목록으로 보기 (미리보기 옆에 이름)"
            >
              <Icon name="list" size={16} />
            </button>
          </div>
        )}
      </div>
      <FileList files={files} error={error} mode="box" grid={isPhoto && photoView === 'grid'} empty="파일이 없어요." />
    </section>
  )
}

/** 영구저장소: 맨 위 또는 폴더 안 */
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
      <section className="card">
        <div className="card-header">
          <h2>{folderId === null ? '폴더와 파일' : '폴더 내용'}</h2>
          <div className="card-header-actions">
            <button className="btn btn-ghost small" onClick={newFolder}>
              <Icon name="folderPlus" size={16} /> 새 폴더
            </button>
          </div>
        </div>
        <p className="muted small">
          {folderId === null &&
            "여기 있는 파일은 자동으로 지워지지 않아요. 임시함에서 상자 버튼을 누른 파일은 '사진', '문서', '기타파일' 폴더로 와요. "}
          파일이나 폴더를 끌어서 폴더(또는 위쪽 경로)에 놓으면 그 안으로 옮겨져요. 폰에서는 길게 눌러 끌면 돼요.
        </p>

        {subfolders.length > 0 && (
          <ul className="file-list">
            {subfolders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                onRename={() => {
                  const name = prompt('새 이름', f.name)
                  if (name?.trim()) act(() => api.renameFolder(f.id, name.trim()))
                }}
                onMove={() => setMovingFolder(f)}
                onDelete={() => {
                  if (confirm(`"${f.name}" 폴더를 지울까요? 안에 있던 파일과 폴더는 한 칸 위로 옮겨져요.`))
                    act(() => api.deleteFolder(f.id))
                }}
              />
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

/** 영구저장소의 폴더 한 줄. 끌어서 다른 폴더에 넣을 수 있고, 파일/폴더를 끌어다 놓으면 이 폴더로 들어온다. */
function FolderRow({
  folder,
  onRename,
  onMove,
  onDelete,
}: {
  folder: Folder
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const { over, props } = useDropTarget(folder.id)
  const { active: selecting } = useSelection()
  const item = { kind: 'folder' as const, id: folder.id, name: folder.name }
  const touchProps = useTouchDrag(() => item)
  return (
    <li
      className={`file-row ${over ? 'drop-over' : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, item)}
      {...props}
      {...touchProps}
    >
      <Link className="thumb folder-thumb" to={`/files?folder=${folder.id}`} draggable={false}>
        <Icon name="folder" size={24} />
      </Link>
      <div className="file-info">
        <div className="file-name-line">
          <Link className="file-name" to={`/files?folder=${folder.id}`} draggable={false}>
            {folder.name}
          </Link>
          <button className="icon-btn small rename-btn" title="이름 바꾸기" onClick={onRename}>
            <Icon name="edit" size={14} />
          </button>
        </div>
      </div>
      <div className="file-actions" hidden={selecting}>
        <button className="square-btn" title="폴더 이동 (끌어서 다른 폴더에 놓아도 돼요)" onClick={onMove}>
          <Icon name="move" />
        </button>
        <button className="square-btn danger" title="폴더 삭제 (안의 파일은 한 칸 위로 나와요)" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  )
}

/** 경로 표시의 한 칸. 파일/폴더를 끌어다 놓으면 그 위치로 옮긴다 (folderId null: 영구저장소 맨 위). */
function CrumbLink({ to, folderId, children }: { to: string; folderId: number | null; children: ReactNode }) {
  const { over, props } = useDropTarget(folderId)
  return (
    <Link to={to} className={over ? 'drop-over' : ''} {...props}>
      {children}
    </Link>
  )
}

/** 파일 목록 + 미리보기 + 폴더 이동 창 */
function FileList({
  files,
  error,
  mode,
  folders = [],
  empty,
  grid = false,
}: {
  files: FileItem[] | null
  error: string
  mode: 'box' | 'storage'
  folders?: Folder[]
  empty: string
  grid?: boolean // 임시사진함: 큰 사진 격자로
}) {
  const { refresh } = useRefresh()
  const [preview, setPreview] = useState<number | null>(null)
  const [moving, setMoving] = useState<FileItem | null>(null)

  return (
    <>
      {error && <p className="error">{error}</p>}
      {files === null && <p className="muted">불러오는 중…</p>}
      {files?.length === 0 && empty && <p className="muted empty-small">{empty}</p>}
      {grid ? (
        <ul className="photo-grid photo-grid-page">
          {files?.map((f, i) => (
            <PhotoTile key={f.id} file={f} mode={mode} onOpen={() => setPreview(i)} onMove={() => setMoving(f)} />
          ))}
        </ul>
      ) : (
        <ul className="file-list">
          {files?.map((f, i) => (
            <FileRow key={f.id} file={f} mode={mode} onOpen={() => setPreview(i)} onMove={() => setMoving(f)} />
          ))}
        </ul>
      )}
      {preview !== null && files && <PreviewModal files={files} index={preview} onClose={() => setPreview(null)} />}
      {moving && (
        <FolderPicker
          title={`"${moving.name}"을(를) 어디로 옮길까요?`}
          folders={folders}
          onClose={() => setMoving(null)}
          onPick={async (folderId) => {
            setMoving(null)
            try {
              await api.moveFiles([moving.id], { folderId })
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
