import { useEffect, useRef, useState } from 'react'
import { api, fileUrl, thumbUrl, type FileItem } from '../api'
import { startDrag, useTouchDrag, type DragItem } from '../dnd'
import { categoryLabels } from '../fileTypes'
import { daysLeft, formatBytes, formatDate } from '../format'
import { useRefresh } from '../refresh'
import { useSelection } from '../selection'
import { Icon } from './Icon'

type Mode = 'box' | 'storage'

/**
 * 파일 하나에 대한 버튼 동작.
 * 버튼을 누르면 서버 응답을 기다리지 않고 바로 목록에서 숨긴다 (빠르게 느껴지도록).
 * 서버에서 실패하면 다시 보여 주고 알린다. 성공하면 다른 목록(용량 등)도 새로 불러온다.
 */
function useFileActions() {
  const { refresh } = useRefresh()
  const [hidden, setHidden] = useState(false)
  const act = (fn: () => Promise<unknown>, removesRow = true) => async () => {
    if (removesRow) setHidden(true)
    try {
      await fn()
      refresh()
    } catch (e) {
      setHidden(false)
      alert((e as Error).message)
    }
  }
  return { hidden, act }
}

/**
 * 파일 한 줄·사진 한 장에 공통인 것: 선택 모드, 끌기(PC 드래그, 폰 길게 누르기).
 * 선택 모드에서는 누르면 파일이 열리는 대신 선택/해제된다.
 * 선택된 파일을 끌면 선택한 파일 전부를 함께 옮긴다.
 */
function useItemBehavior(file: FileItem, mode: Mode, onOpen: () => void) {
  const sel = useSelection()
  const selected = sel.active && sel.ids.has(file.id)
  const draggable = mode === 'storage'
  const dragItem = (): DragItem => {
    const item: DragItem = { kind: 'file', id: file.id, name: file.name }
    if (selected && sel.ids.size > 1) item.ids = [...sel.ids]
    return item
  }
  const touchProps = useTouchDrag(dragItem, draggable)
  return {
    selecting: sel.active,
    selected,
    open: sel.active ? () => sel.toggle(file.id) : onOpen,
    itemProps: {
      draggable,
      onDragStart: (e: React.DragEvent) => startDrag(e, dragItem()),
      onClick: sel.active ? () => sel.toggle(file.id) : undefined,
      ...touchProps,
    },
  }
}

/** 선택 모드에서 보이는 체크 표시 */
function Check({ on }: { on: boolean }) {
  return <span className={`select-check ${on ? 'on' : ''}`}>{on && <Icon name="check" size={14} />}</span>
}

/** 임시함 파일은 "N일 뒤 삭제", 휴지통 파일은 "N일 뒤 영구삭제" */
export function ExpiryNote({ file, compact = false }: { file: FileItem; compact?: boolean }) {
  if (!file.expiresAt) return null
  const days = daysLeft(file.expiresAt)
  const urgent = days <= 3
  if (compact) {
    // 사진 칸에서는 일주일 안에 지워질 때만 작게 표시
    if (days > 7) return null
    return <span className={`expiry-badge ${urgent ? 'urgent' : ''}`}>D-{days}</span>
  }
  const text = file.deletedAt
    ? days === 0 ? '곧 영구삭제' : `${days}일 뒤 영구삭제`
    : days === 0 ? '곧 휴지통으로' : `${days}일 뒤 삭제`
  return <span className={`expiry-note ${urgent ? 'urgent' : ''}`}>{text}</span>
}

/**
 * 파일 한 줄 (임시문서함, 임시파일함, 영구저장소). 어디에 보여 주느냐(mode)에 따라 버튼이 달라진다.
 *  - box:     임시함 → 다운로드, 영구저장소로 보내기(stash), 삭제
 *  - storage: 영구저장소(폴더) → 다운로드, 폴더 이동, 임시함으로 돌려놓기, 삭제. 끌어서 폴더에 넣을 수 있다.
 */
export function FileRow({
  file,
  mode,
  onOpen,
  onMove,
  showThumb = file.category === 'photo' || mode === 'storage',
}: {
  file: FileItem
  mode: Mode
  onOpen: () => void
  onMove?: () => void
  showThumb?: boolean
}) {
  const { hidden, act } = useFileActions()
  const { selecting, selected, open, itemProps } = useItemBehavior(file, mode, onOpen)
  if (hidden) return null

  return (
    <li className={`file-row ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`} {...itemProps}>
      {selecting && <Check on={selected} />}
      {showThumb && <Thumb file={file} onOpen={open} />}
      <div className="file-info">
        <FileName file={file} onOpen={open} noRename={selecting} />
        <span className="muted small file-meta">
          {formatBytes(file.size)} · {formatDate(file.createdAt)}
          {file.expiresAt && !file.stashed && (
            <>
              {' · '}
              <ExpiryNote file={file} />
            </>
          )}
        </span>
      </div>
      {!selecting && <FileActions file={file} mode={mode} act={act} onMove={onMove} />}
    </li>
  )
}

/**
 * 임시사진함의 사진 한 장: 큰 정사각형 미리보기, 그 아래 작은 이름, 그 아래 버튼들.
 */
export function PhotoTile({ file, mode, onOpen, onMove }: { file: FileItem; mode: Mode; onOpen: () => void; onMove?: () => void }) {
  const { hidden, act } = useFileActions()
  const { selecting, selected, open, itemProps } = useItemBehavior(file, mode, onOpen)
  if (hidden) return null
  return (
    <li className={`photo-tile ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`} {...itemProps}>
      <div className="photo-thumb-wrap">
        <Thumb file={file} onOpen={open} className="photo-thumb" />
        {selecting && <Check on={selected} />}
        {!file.stashed && <ExpiryNote file={file} compact />}
      </div>
      <FileName file={file} onOpen={open} small noRename={selecting} />
      {!selecting && <FileActions file={file} mode={mode} act={act} onMove={onMove} compact />}
    </li>
  )
}

/** 사진은 썸네일, 그 밖의 파일은 아이콘. 누르면 파일 창이 열린다. */
export function Thumb({ file, onOpen, className = 'thumb' }: { file: FileItem; onOpen?: () => void; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      className={className}
      onClick={(e) => {
        e.stopPropagation() // 선택 모드에서 줄 전체의 onClick과 두 번 불리지 않게
        onOpen?.()
      }}
      title="크게 보기"
      disabled={!onOpen}
    >
      {!failed && file.category === 'photo' ? (
        // loading="lazy": 화면에 보일 때만 불러온다. decoding="async": 그리는 동안 화면이 멈추지 않게.
        // draggable={false}: 사진을 끌면 사진 대신 줄 전체가 끌리도록.
        <img
          src={thumbUrl(file.id)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="file" size={24} />
      )}
    </button>
  )
}

/**
 * 파일 이름 + 옆의 연필(이름 바꾸기) 버튼. 연필을 누르면 그 자리에서 고칠 수 있다.
 * Enter: 저장, Esc: 취소. 바뀐 이름은 서버 응답을 기다리지 않고 바로 보여 준다.
 */
export function FileName({
  file,
  onOpen,
  small = false,
  noRename = false,
}: {
  file: FileItem
  onOpen?: () => void
  small?: boolean
  noRename?: boolean
}) {
  const { refresh } = useRefresh()
  const [name, setName] = useState(file.name)
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => setName(file.name), [file.name])
  useEffect(() => {
    if (!editing || !input.current) return
    input.current.focus()
    // 확장자는 빼고 이름 부분만 선택해 두어 바로 고쳐 쓸 수 있게
    const dot = name.lastIndexOf('.')
    input.current.setSelectionRange(0, dot > 0 ? dot : name.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const save = async (value: string) => {
    setEditing(false)
    value = value.trim()
    if (!value || value === name) return
    const before = name
    setName(value)
    try {
      await api.updateFile(file.id, { name: value })
      refresh()
    } catch (e) {
      setName(before)
      alert((e as Error).message)
    }
  }

  if (editing) {
    return (
      <input
        ref={input}
        className={`rename-input ${small ? 'small' : ''}`}
        defaultValue={name}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save(e.currentTarget.value)
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={(e) => save(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
      />
    )
  }
  return (
    <div className={`file-name-line ${small ? 'small' : ''}`}>
      <button
        className="file-name link-btn"
        onClick={(e) => {
          e.stopPropagation()
          onOpen?.()
        }}
        title={name}
      >
        {name}
      </button>
      {!noRename && (
        <button className="icon-btn small rename-btn" onClick={() => setEditing(true)} title="이름 바꾸기">
          <Icon name="edit" size={14} />
        </button>
      )}
    </div>
  )
}

/** stash하면 들어가는 영구저장소 폴더 이름 (서버와 같게) */
const stashFolderNames = { photo: '사진', document: '문서', other: '기타파일' } as const

function FileActions({
  file,
  mode,
  act,
  onMove,
  compact = false,
}: {
  file: FileItem
  mode: Mode
  act: ReturnType<typeof useFileActions>['act']
  onMove?: () => void
  compact?: boolean
}) {
  return (
    <div className={`file-actions ${compact ? 'compact' : ''}`}>
      <a className="square-btn" href={fileUrl(file.id)} download title="다운로드">
        <Icon name="download" />
      </a>
      {mode === 'box' && (
        <button
          className="square-btn"
          title={`영구저장소의 '${stashFolderNames[file.category]}' 폴더로 보내기 (자동으로 지워지지 않아요)`}
          onClick={act(() => api.updateFile(file.id, { stashed: true }))}
        >
          <Icon name="stash" />
        </button>
      )}
      {mode === 'storage' && (
        <>
          <button className="square-btn" title="폴더 이동 (끌어서 폴더에 놓아도 돼요)" onClick={onMove}>
            <Icon name="move" />
          </button>
          <button
            className="square-btn"
            title={`${categoryLabels[file.category]}으로 돌려놓기 (자동삭제 기간이 다시 시작돼요)`}
            onClick={act(() => api.updateFile(file.id, { stashed: false }))}
          >
            <Icon name="unstash" />
          </button>
        </>
      )}
      <button className="square-btn danger" title="삭제 (휴지통으로)" onClick={act(() => api.trashFile(file.id))}>
        <Icon name="trash" />
      </button>
    </div>
  )
}
