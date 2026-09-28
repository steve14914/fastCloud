import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { api, type Memo } from '../api'
import { isEmptyHtml, sanitizeMemoHtml } from '../memoHtml'
import { Icon } from './Icon'

const TABS_KEY = 'fastcloud.memoTabs' // 열어 둔 탭 (메모 id 목록)
const ACTIVE_KEY = 'fastcloud.activeMemo' // 마지막으로 보던 메모
const AUTOSAVE_DELAY = 1000 // 입력을 멈추고 1초 뒤 자동 저장

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/**
 * 메인 화면의 메모장 (윈도우 메모장처럼 위에 탭, 오른쪽에 메모 목록. 폰에서는 목록이 아래).
 *  - 제목(큰 글씨)과 내용. 비어 있으면 옅은 회색으로 '제목', '내용을 입력하세요'가 보인다.
 *  - 서식 버튼: 글자 크기, 굵게, 형광펜, 체크리스트 등을 고르는 서식 창을 연다.
 *  - 입력을 멈추면 1초 뒤 자동 저장, 저장 버튼, Ctrl+S
 *  - 새 메모(+ 탭)는 뭔가 쓰기 전까지 서버에 만들지 않는다.
 */
export function MemoBox() {
  const [memos, setMemos] = useState<Memo[] | null>(null) // 오른쪽 목록 (최근에 고친 순)
  const [tabs, setTabs] = useState<number[]>(() => readJSON(TABS_KEY, []))
  const [memoId, setMemoId] = useState<number | null>(null) // 지금 보는 메모 (null: 아직 저장 안 된 새 메모)
  const [title, setTitle] = useState('')
  const [bodyEmpty, setBodyEmpty] = useState(true)
  const [state, setState] = useState<SaveState>('saved')
  const [showTools, setShowTools] = useState(false)
  const editor = useRef<HTMLDivElement>(null)

  // 저장 함수가 항상 "지금" 값을 보도록 ref에도 같이 둔다.
  // (state는 비동기 함수 안에서 예전 값에 머물러 있을 수 있다)
  const latest = useRef({ memoId: null as number | null, title: '', body: '', savedTitle: '', savedBody: '' })
  const bodies = useRef(new Map<number, Memo>()) // 한 번 연 메모 본문 (탭을 오갈 때 바로 보여 주려고)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => localStorage.setItem(TABS_KEY, JSON.stringify(tabs)), [tabs])
  useEffect(() => {
    if (memoId === null) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, String(memoId))
  }, [memoId])

  // 목록에 메모를 넣거나 바꾸고 맨 위로 올린다 (방금 고친 메모가 가장 최근)
  const upsertListItem = (m: Memo) =>
    setMemos((list) => [{ ...m, body: undefined }, ...(list ?? []).filter((x) => x.id !== m.id)])

  // save: 바뀐 게 있으면 서버에 저장한다. 저장이 겹치지 않도록 앞선 저장이 끝난 뒤에 실행한다.
  const save = useCallback(() => {
    window.clearTimeout(timer.current)
    saving.current = saving.current.then(async () => {
      const cur = latest.current
      if (cur.title === cur.savedTitle && cur.body === cur.savedBody) return
      const { title, body } = cur
      setState('saving')
      try {
        let m: Memo
        if (cur.memoId === null) {
          m = await api.createMemo(title, body)
          cur.memoId = m.id
          setMemoId(m.id)
          setTabs((t) => (t.includes(m.id) ? t : [...t, m.id]))
        } else {
          m = await api.updateMemo(cur.memoId, title, body)
        }
        bodies.current.set(m.id, m)
        upsertListItem(m)
        cur.savedTitle = title
        cur.savedBody = body
        // 저장하는 사이에 더 입력했으면 dirty로 남겨 두고 다시 저장을 예약한다
        if (cur.title === title && cur.body === body) {
          setState('saved')
        } else {
          setState('dirty')
          timer.current = window.setTimeout(save, AUTOSAVE_DELAY)
        }
      } catch {
        setState('error')
      }
    })
    return saving.current
  }, [])

  /** 메모를 화면에 연다 (null이면 빈 새 메모) */
  const show = useCallback((m: Memo | null) => {
    window.clearTimeout(timer.current)
    const body = m?.body ?? ''
    latest.current = { memoId: m?.id ?? null, title: m?.title ?? '', body, savedTitle: m?.title ?? '', savedBody: body }
    setMemoId(m?.id ?? null)
    setTitle(m?.title ?? '')
    if (editor.current) {
      editor.current.innerHTML = sanitizeMemoHtml(body)
      setBodyEmpty(isEmptyHtml(editor.current))
    }
    setState('saved')
    if (m) setTabs((t) => (t.includes(m.id) ? t : [...t, m.id]))
  }, [])

  /** 지금 메모를 저장하고 id 메모로 바꾼다. 본문을 이미 받아 둔 메모는 기다리지 않고 바로 보여 준다. */
  const open = useCallback(
    async (id: number | null) => {
      await save()
      if (id === null) return show(null)
      const cached = bodies.current.get(id)
      if (cached) show(cached)
      try {
        const m = await api.getMemo(id)
        bodies.current.set(id, m)
        // 받는 사이 다른 메모로 옮겼거나 이미 고치기 시작했으면 덮어쓰지 않는다
        const cur = latest.current
        if (!cached || (cur.memoId === id && cur.title === cur.savedTitle && cur.body === cur.savedBody)) show(m)
      } catch (e) {
        if (!cached) alert((e as Error).message)
      }
    },
    [save, show],
  )

  // 처음 열 때: 마지막으로 보던 메모와 목록을 동시에 받는다. 보던 메모가 없어졌으면 가장 최근 메모를 연다.
  useEffect(() => {
    const last = Number(localStorage.getItem(ACTIVE_KEY))
    const untouched = () => latest.current.memoId === null && latest.current.title === '' && latest.current.body === ''
    const lastMemo = last
      ? api.getMemo(last).then(
          (m) => {
            bodies.current.set(m.id, m)
            if (untouched()) show(m)
            return true
          },
          () => false,
        )
      : Promise.resolve(false)
    Promise.all([api.listMemos(), lastMemo])
      .then(([list, shown]) => {
        setMemos(list)
        const ids = new Set(list.map((m) => m.id))
        const openTabs = readJSON<number[]>(TABS_KEY, []).filter((id) => ids.has(id))
        setTabs((t) => [...openTabs, ...t.filter((id) => !openTabs.includes(id) && ids.has(id))])
        const first = openTabs[0] ?? list[0]?.id ?? null
        if (!shown && first !== null && untouched()) open(first)
      })
      .catch(() => setMemos([]))
  }, [open, show])

  // Ctrl+S (맥은 Cmd+S): 브라우저의 "페이지 저장" 대신 메모를 저장한다
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // 폰에서 다른 앱으로 넘어가거나 탭을 닫기 전에 저장한다
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const cur = latest.current
      if (cur.title !== cur.savedTitle || cur.body !== cur.savedBody) {
        save()
        e.preventDefault() // "저장하지 않은 변경 사항" 경고
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      save() // 다른 화면으로 이동할 때
    }
  }, [save])

  const changed = () => {
    const cur = latest.current
    setState(cur.title === cur.savedTitle && cur.body === cur.savedBody ? 'saved' : 'dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, AUTOSAVE_DELAY)
  }

  const onTitle = (value: string) => {
    setTitle(value)
    latest.current.title = value
    changed()
  }

  const onBodyInput = () => {
    const el = editor.current!
    const empty = isEmptyHtml(el)
    setBodyEmpty(empty)
    latest.current.body = empty ? '' : el.innerHTML
    changed()
  }

  const closeTab = async (id: number) => {
    const rest = tabs.filter((t) => t !== id)
    setTabs(rest)
    if (id === memoId) {
      const i = tabs.indexOf(id)
      await open(rest[Math.min(i, rest.length - 1)] ?? null)
    }
  }

  const remove = async (m: Memo) => {
    if (!confirm(`"${m.label}" 메모를 지울까요?`)) return
    try {
      await api.deleteMemo(m.id)
    } catch (e) {
      return alert((e as Error).message)
    }
    bodies.current.delete(m.id)
    setMemos((list) => list?.filter((x) => x.id !== m.id) ?? null)
    const rest = tabs.filter((t) => t !== m.id)
    setTabs(rest)
    if (m.id === latest.current.memoId) {
      // 지운 메모는 저장하지 않고 바로 다른 탭으로
      window.clearTimeout(timer.current)
      latest.current.savedTitle = latest.current.title
      latest.current.savedBody = latest.current.body
      const next = rest[0] ?? null
      if (next === null) show(null)
      else open(next)
    }
  }

  const labelOf = (id: number) => memos?.find((m) => m.id === id)?.label ?? '…'
  const stateLabel = { saved: '저장됨', dirty: '입력 중…', saving: '저장 중…', error: '저장 실패' }[state]

  return (
    <section className="card memo-box">
      <div className="card-header">
        <h2>메모</h2>
        <span className={`muted small ${state === 'error' ? 'error' : ''}`}>{stateLabel}</span>
        <div className="card-header-actions">
          <button
            className={`btn btn-ghost small ${showTools ? 'active' : ''}`}
            onClick={() => setShowTools((v) => !v)}
            title="글자 크기, 굵게, 형광펜, 체크리스트"
          >
            <Icon name="format" size={16} /> 서식
          </button>
          <button className="btn btn-ghost small" onClick={save} title="저장 (Ctrl+S)">
            <Icon name="save" size={16} /> 저장
          </button>
        </div>
      </div>

      <div className="memo-tabs" role="tablist">
        {tabs.map((id) => (
          <div key={id} className={`memo-tab ${id === memoId ? 'current' : ''}`} role="tab" aria-selected={id === memoId}>
            <button className="memo-tab-label" onClick={() => id !== memoId && open(id)}>
              {id === memoId ? title.trim() || labelOf(id) : labelOf(id)}
            </button>
            <button className="icon-btn small" onClick={() => closeTab(id)} title="탭 닫기">
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        {memoId === null && (
          <div className="memo-tab current" role="tab" aria-selected>
            <span className="memo-tab-label">{title.trim() || '새 메모'}</span>
          </div>
        )}
        <button className="icon-btn small memo-tab-new" onClick={() => open(null)} title="새 메모">
          <Icon name="plus" size={16} />
        </button>
      </div>

      <div className="memo-main">
        <div className="memo-editor">
          {showTools && <FormatTools editor={editor} onChange={onBodyInput} onClose={() => setShowTools(false)} />}
          <input
            className="memo-title"
            value={title}
            placeholder="제목"
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor.current?.focus()
              }
            }}
          />
          <div
            ref={editor}
            className={`memo-body ${bodyEmpty ? 'is-empty' : ''}`}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="내용을 입력하세요"
            spellCheck={false}
            onInput={onBodyInput}
            onClick={(e) => toggleCheck(e, onBodyInput)}
            onKeyDown={uncheckNewItem}
            onPaste={(e) => {
              // 파일(캡처한 사진 등)은 화면 전체의 업로드로 넘긴다. 글자는 서식 없이 붙여넣는다.
              if (e.clipboardData.files.length > 0) return
              e.preventDefault()
              document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
            }}
          />
        </div>

        <aside className="memo-side">
          <div className="muted small memo-side-title">메모 목록</div>
          {memos?.length === 0 && <p className="muted small">저장된 메모가 없어요.</p>}
          <ul className="memo-list">
            {memos?.map((m) => (
              <li key={m.id} className={m.id === memoId ? 'current' : ''}>
                <button className="memo-list-item ellipsis" onClick={() => m.id !== memoId && open(m.id)} title={m.label}>
                  {m.label}
                </button>
                <button className="icon-btn small danger" onClick={() => remove(m)} title="메모 삭제">
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  )
}

/**
 * 서식 창. 버튼을 눌러도 본문의 선택 영역이 풀리지 않도록 mousedown 기본 동작을 막는다.
 * 브라우저의 편집 명령(execCommand)을 쓴다. 오래된 API지만 모든 브라우저에서 동작하고 라이브러리가 필요 없다.
 */
function FormatTools({
  editor,
  onChange,
  onClose,
}: {
  editor: React.RefObject<HTMLDivElement | null>
  onChange: () => void
  onClose: () => void
}) {
  const run = (cmd: string, value?: string) => {
    editor.current?.focus()
    document.execCommand(cmd, false, value)
    onChange()
  }
  const keep = (e: MouseEvent) => e.preventDefault()

  // 체크리스트/글머리: 지금 줄을 목록으로 만들거나, 이미 그 목록이면 되돌린다
  const list = (checklist: boolean) => {
    editor.current?.focus()
    const ul = currentList(editor.current)
    if (ul && ul.classList.contains('checklist') === checklist) {
      document.execCommand('insertUnorderedList') // 목록 풀기
    } else if (ul) {
      ul.classList.toggle('checklist', checklist)
    } else {
      document.execCommand('insertUnorderedList')
      const created = currentList(editor.current)
      if (created && checklist) created.classList.add('checklist')
    }
    onChange()
  }

  const sizes = [
    { label: '작게', size: '2' },
    { label: '보통', size: '3' },
    { label: '크게', size: '5' },
    { label: '아주 크게', size: '6' },
  ]
  const colors = [
    { label: '노랑', color: '#fff176' },
    { label: '초록', color: '#b9f6ca' },
    { label: '분홍', color: '#ffcdd2' },
    { label: '하늘', color: '#b3e5fc' },
  ]

  return (
    <div className="format-tools" onMouseDown={keep}>
      <div className="format-tools-header">
        <span className="small muted">서식</span>
        <button className="icon-btn small" onClick={onClose} title="서식 창 닫기">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="format-row">
        {sizes.map((s) => (
          <button key={s.size} className={`fmt-btn fmt-size-${s.size}`} onClick={() => run('fontSize', s.size)} title={`글자 ${s.label}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="format-row">
        <button className="fmt-btn" onClick={() => run('bold')} title="굵게 (Ctrl+B)">
          <b>B</b>
        </button>
        <button className="fmt-btn" onClick={() => run('italic')} title="기울임 (Ctrl+I)">
          <i>I</i>
        </button>
        <button className="fmt-btn" onClick={() => run('underline')} title="밑줄 (Ctrl+U)">
          <u>U</u>
        </button>
        <button className="fmt-btn" onClick={() => run('strikeThrough')} title="취소선">
          <s>S</s>
        </button>
        <span className="fmt-sep" />
        {colors.map((c) => (
          <button
            key={c.color}
            className="fmt-btn fmt-color"
            onClick={() => run('hiliteColor', c.color)}
            title={`형광펜 (${c.label})`}
          >
            <span style={{ background: c.color }} />
          </button>
        ))}
        <button className="fmt-btn" onClick={() => run('hiliteColor', 'transparent')} title="형광펜 지우기">
          <Icon name="highlight" size={16} />
        </button>
        <span className="fmt-sep" />
        <button className="fmt-btn" onClick={() => list(true)} title="체크리스트">
          <Icon name="checklist" size={16} />
        </button>
        <button className="fmt-btn" onClick={() => list(false)} title="글머리 기호">
          <Icon name="bullets" size={16} />
        </button>
        <button className="fmt-btn" onClick={() => run('removeFormat')} title="서식 지우기">
          <Icon name="eraser" size={16} />
        </button>
      </div>
    </div>
  )
}

/** 커서가 있는 곳의 <ul> (본문 안에 있을 때만) */
function currentList(root: HTMLElement | null): HTMLUListElement | null {
  const node = window.getSelection()?.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  const ul = el?.closest('ul')
  return ul && root?.contains(ul) ? ul : null
}

/** 체크리스트 항목의 네모(왼쪽 28px)를 누르면 체크/해제 */
function toggleCheck(e: MouseEvent<HTMLDivElement>, onChange: () => void) {
  const li = (e.target as HTMLElement).closest('li')
  if (!li || !li.parentElement?.classList.contains('checklist')) return
  if (e.clientX - li.getBoundingClientRect().left > 28) return
  if (li.dataset.checked === 'true') delete li.dataset.checked
  else li.dataset.checked = 'true'
  onChange()
}

/** 체크된 항목에서 Enter를 치면 브라우저가 체크 표시까지 복사하므로, 새 항목은 체크를 뺀다 */
function uncheckNewItem(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Enter') return
  const root = e.currentTarget
  requestAnimationFrame(() => {
    const ul = currentList(root)
    const node = window.getSelection()?.anchorNode
    const li = (node instanceof Element ? node : node?.parentElement)?.closest('li')
    if (ul?.classList.contains('checklist') && li && li.textContent === '') delete li.dataset.checked
  })
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T
  } catch {
    return fallback
  }
}
