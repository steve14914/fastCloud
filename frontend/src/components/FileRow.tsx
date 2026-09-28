import { useEffect, useRef, useState } from 'react'
import { api, fileUrl, thumbUrl, type FileItem } from '../api'
import { startDrag } from '../dnd'
import { categoryLabels } from '../fileTypes'
import { formatBytes, formatDate } from '../format'
import { useRefresh } from '../refresh'
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
 * 파일 한 줄 (문서함, 기타파일함, 저장공간). 어디에 보여 주느냐(mode)에 따라 버튼이 달라진다.
 *  - box:     사진/문서/기타함 → 다운로드, 저장공간으로 보내기(stash), 삭제
 *  - storage: 저장공간(폴더) → 다운로드, 폴더 이동, 함으로 돌려놓기, 삭제. 끌어서 폴더에 넣을 수 있다.
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
  if (hidden) return null

  return (
    <li
      className="file-row"
      draggable={mode === 'storage'}
      onDragStart={(e) => startDrag(e, { kind: 'file', id: file.id, name: file.name })}
    >
      {showThumb && <Thumb file={file} onOpen={onOpen} />}
      <div className="file-info">
        <FileName file={file} onOpen={onOpen} />
        <span className="muted small file-meta">
          {formatBytes(file.size)} · {formatDate(file.createdAt)}
        </span>
      </div>
      <FileActions file={file} mode={mode} act={act} onMove={onMove} />
    </li>
  )
}

/**
 * 사진함의 사진 한 장: 큰 정사각형 미리보기, 그 아래 작은 이름, 그 아래 버튼들.
 */
export function PhotoTile({ file, mode, onOpen, onMove }: { file: FileItem; mode: Mode; onOpen: () => void; onMove?: () => void }) {
  const { hidden, act } = useFileActions()
  if (hidden) return null
  return (
    <li
      className="photo-tile"
      draggable={mode === 'storage'}
      onDragStart={(e) => startDrag(e, { kind: 'file', id: file.id, name: file.name })}
    >
      <Thumb file={file} onOpen={onOpen} className="photo-thumb" />
      <FileName file={file} onOpen={onOpen} small />
      <FileActions file={file} mode={mode} act={act} onMove={onMove} compact />
    </li>
  )
}

/** 사진은 썸네일, 그 밖의 파일은 아이콘. 누르면 파일 창이 열린다. */
export function Thumb({ file, onOpen, className = 'thumb' }: { file: FileItem; onOpen?: () => void; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <button className={className} onClick={onOpen} title="크게 보기" disabled={!onOpen}>
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
export function FileName({ file, onOpen, small = false }: { file: FileItem; onOpen?: () => void; small?: boolean }) {
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
      <button className="file-name link-btn" onClick={onOpen} title={name}>
        {name}
      </button>
      <button className="icon-btn small rename-btn" onClick={() => setEditing(true)} title="이름 바꾸기">
        <Icon name="edit" size={14} />
      </button>
    </div>
  )
}

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
          title="저장공간으로 보내기 (메인 화면에서 빠지고 전체 파일에서 폴더로 정리할 수 있어요)"
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
            title={`${categoryLabels[file.category]}으로 돌려놓기`}
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
