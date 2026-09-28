import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Category, type FileItem, type Folder } from '../api'
import { Check, FileRow, PhotoTile, useSelectableItem } from '../components/FileRow'
import { FolderPicker } from '../components/FolderPicker'
import { Icon } from '../components/Icon'
import { useSetUploadTarget } from '../components/Layout'
import { PreviewModal } from '../components/PreviewModal'
import { UploadBox, UploadButton } from '../components/UploadBox'
import { useDropTarget, useIsDragging } from '../dnd'
import { categoryLabels } from '../fileTypes'
import { useLoad } from '../hooks'
import { useRefresh } from '../refresh'
import { fileKey, folderKey, useSelection, useSelectionOrder, useSetSelectionHere } from '../selection'
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

  // 선택 기능의 "지금 보고 있는 곳" (선택은 이 경로 안에서만, 완료를 누르면 이곳으로 옮긴다)
  useSetSelectionHere(
    box
      ? { key: 'box', target: { box: true }, label: '임시함' }
      : {
          key: `folder-${folderId ?? 'root'}`,
          target: { folderId },
          label: folderId === null ? '영구저장소 맨 위' : `'${current?.name ?? '폴더'}' 폴더`,
        },
  )
  const title = box ? categoryLabels[box] : folderId === null ? '영구저장소' : (current?.name ?? '')

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{title}</h1>
        <div className="page-header-actions">
          {sel.phase === 'off' || sel.phase === 'select' ? (
            <button
              className={`btn ${sel.active ? 'btn-primary' : 'btn-ghost'}`}
              onClick={sel.active ? sel.stop : sel.start}
              title="파일·폴더를 여러 개 골라 옮기거나 복사하기 (PC에서는 Ctrl+클릭, Shift+클릭도 돼요)"
            >
              <Icon name="checklist" /> {sel.active ? '선택 취소' : '선택'}
            </button>
          ) : null}
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

      <PathBar box={box} folderId={folderId} folders={folders ?? []} />

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

/**
 * 작업화면 위쪽의 경로 표시줄 (PC 파일 관리자의 주소 표시줄처럼).
 * 영구저장소 › 폴더 › 하위 폴더. 누르면 그 경로로 가고, 파일·폴더를 끌어다 놓으면 그곳으로 옮긴다.
 * 임시함은 메인 › 임시사진함.
 */
function PathBar({ box, folderId, folders }: { box: Category | null; folderId: number | null; folders: Folder[] }) {
  const path: Folder[] = []
  let cur = folders.find((f) => f.id === folderId)
  while (cur) {
    path.unshift(cur)
    cur = folders.find((f) => f.id === cur!.parentId)
  }
  const sep = <Icon name="chevronRight" size={14} />
  if (box) {
    return (
      <nav className="path-bar" aria-label="경로">
        <Icon name="stash" size={16} />
        <Link className="path-part" to="/">
          메인
        </Link>
        {sep}
        <span className="path-part current">{categoryLabels[box]}</span>
      </nav>
    )
  }
  return (
    <nav className="path-bar" aria-label="경로">
      <Icon name="folder" size={16} />
      {folderId === null ? (
        <span className="path-part current">영구저장소</span>
      ) : (
        <CrumbLink to="/files" folderId={null}>
          영구저장소
        </CrumbLink>
      )}
      {path.map((f, i) => (
        <span key={f.id} className="path-step">
          {sep}
          {i === path.length - 1 ? (
            <span className="path-part current">{f.name}</span>
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
  useSelectionOrder(files?.map((f) => fileKey(f.id)) ?? [])
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
  useSelectionOrder([...subfolders.map((f) => folderKey(f.id)), ...(files ?? []).map((f) => fileKey(f.id))])
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
  const { selecting, selected, open, itemProps } = useSelectableItem(
    folderKey(folder.id),
    { kind: 'folder', id: folder.id, name: folder.name },
    true,
    () => {}, // 고르는 중이 아니면 링크가 그대로 폴더를 연다
  )
  // 링크를 눌렀을 때: 고르는 중이면 폴더를 열지 않고 고르기만 한다
  const onLink = (e: React.MouseEvent) => {
    e.stopPropagation()
    open(e)
  }
  return (
    <li
      className={`file-row ${over ? 'drop-over' : ''} ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      {...itemProps}
      {...props}
    >
      {selecting && <Check on={selected} />}
      <Link className="thumb folder-thumb" to={`/files?folder=${folder.id}`} draggable={false} onClick={onLink}>
        <Icon name="folder" size={24} />
      </Link>
      <div className="file-info">
        <div className="file-name-line">
          <Link className="file-name" to={`/files?folder=${folder.id}`} draggable={false} onClick={onLink}>
            {folder.name}
          </Link>
          {!selecting && (
            <button className="icon-btn small rename-btn" title="이름 바꾸기" onClick={onRename}>
              <Icon name="edit" size={14} />
            </button>
          )}
        </div>
      </div>
      {!selecting && (
        <div className="file-actions">
          <button className="square-btn" title="폴더 이동 (끌어서 다른 폴더에 놓아도 돼요)" onClick={onMove}>
            <Icon name="move" />
          </button>
          <button className="square-btn danger" title="폴더 삭제 (안의 파일은 한 칸 위로 나와요)" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </div>
      )}
    </li>
  )
}

/** 경로 표시의 한 칸. 파일/폴더를 끌어다 놓으면 그 위치로 옮긴다 (folderId null: 영구저장소 맨 위). */
function CrumbLink({ to, folderId, children }: { to: string; folderId: number | null; children: ReactNode }) {
  const { over, props } = useDropTarget(folderId)
  return (
    <Link to={to} className={`path-part ${over ? 'drop-over' : ''}`} {...props}>
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
