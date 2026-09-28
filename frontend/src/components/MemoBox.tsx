import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Memo } from '../api'
import { formatDate } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

const LAST_MEMO_KEY = 'fastcloud.lastMemoId'
const AUTOSAVE_DELAY = 1000 // 입력을 멈추고 1초 뒤 자동 저장

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/**
 * 메인 화면의 텍스트 메모장.
 *  - 입력을 멈추면 1초 뒤 자동 저장, 저장 버튼, Ctrl+S
 *  - 새 메모: 지금 메모를 저장하고 빈 메모를 연다 (빈 메모는 뭔가 쓰기 전까지 서버에 만들지 않는다)
 *  - 메모 목록: 예전 메모 열기 / 지우기
 */
export function MemoBox() {
  const [memoId, setMemoId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [state, setState] = useState<SaveState>('saved')
  const [showList, setShowList] = useState(false)

  // 저장 함수가 항상 "지금" 값을 보도록 ref에도 같이 둔다.
  // (state는 비동기 함수 안에서 예전 값에 머물러 있을 수 있다)
  const latest = useRef({ memoId: null as number | null, text: '', savedText: '' })
  const saving = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)

  // save: 바뀐 게 있으면 서버에 저장한다. 저장이 겹치지 않도록 앞선 저장이 끝난 뒤에 실행한다.
  const save = useCallback(() => {
    window.clearTimeout(timer.current)
    saving.current = saving.current.then(async () => {
      const cur = latest.current
      if (cur.text === cur.savedText) return
      const text = cur.text
      setState('saving')
      try {
        if (cur.memoId === null) {
          const m = await api.createMemo(text)
          cur.memoId = m.id
          setMemoId(m.id)
          localStorage.setItem(LAST_MEMO_KEY, String(m.id))
        } else {
          await api.updateMemo(cur.memoId, text)
        }
        cur.savedText = text
        // 저장하는 사이에 더 입력했으면 dirty로 남겨 두고 다시 저장을 예약한다
        if (cur.text === text) {
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

  const load = useCallback((m: Memo | null) => {
    window.clearTimeout(timer.current)
    latest.current = { memoId: m?.id ?? null, text: m?.body ?? '', savedText: m?.body ?? '' }
    setMemoId(m?.id ?? null)
    setText(m?.body ?? '')
    setState('saved')
    if (m) localStorage.setItem(LAST_MEMO_KEY, String(m.id))
    else localStorage.removeItem(LAST_MEMO_KEY)
  }, [])

  // 처음 열 때: 마지막으로 보던 메모, 없으면 가장 최근 메모를 연다
  useEffect(() => {
    const lastId = Number(localStorage.getItem(LAST_MEMO_KEY))
    const open = async () => {
      if (lastId) {
        try {
          return load(await api.getMemo(lastId))
        } catch {
          // 지워졌으면 아래로
        }
      }
      const list = await api.listMemos()
      load(list.length ? await api.getMemo(list[0].id) : null)
    }
    open().catch(() => {})
  }, [load])

  // Ctrl+S (맥은 Cmd+S): 브라우저의 "페이지 저장" 대신 메모를 저장한다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (latest.current.text !== latest.current.savedText) {
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

  const onChange = (value: string) => {
    setText(value)
    latest.current.text = value
    setState(value === latest.current.savedText ? 'saved' : 'dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, AUTOSAVE_DELAY)
  }

  const newMemo = async () => {
    await save()
    load(null)
  }

  const openMemo = async (id: number) => {
    await save()
    try {
      load(await api.getMemo(id))
      setShowList(false)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const stateLabel = { saved: '저장됨', dirty: '입력 중…', saving: '저장 중…', error: '저장 실패' }[state]

  return (
    <section className="card memo-box">
      <div className="card-header">
        <h2>메모</h2>
        <span className={`muted small ${state === 'error' ? 'error' : ''}`}>{stateLabel}</span>
        <div className="card-header-actions">
          <button className="btn btn-ghost small" onClick={save} title="저장 (Ctrl+S)">
            <Icon name="save" size={16} /> 저장
          </button>
          <button className="btn btn-ghost small" onClick={newMemo}>
            <Icon name="plus" size={16} /> 새 메모
          </button>
          <button className="btn btn-ghost small" onClick={() => setShowList(true)}>
            <Icon name="list" size={16} /> 목록
          </button>
        </div>
      </div>
      <textarea
        className="memo-text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="아무거나 적어 두세요. 자동으로 저장돼요."
        spellCheck={false}
      />
      {showList && (
        <MemoList
          currentId={memoId}
          onOpen={openMemo}
          onDeleted={(id) => id === latest.current.memoId && load(null)}
          onClose={() => setShowList(false)}
        />
      )}
    </section>
  )
}

function MemoList({
  currentId,
  onOpen,
  onDeleted,
  onClose,
}: {
  currentId: number | null
  onOpen: (id: number) => void
  onDeleted: (id: number) => void
  onClose: () => void
}) {
  const [memos, setMemos] = useState<Memo[] | null>(null)
  const reload = () =>
    api
      .listMemos()
      .then(setMemos)
      .catch(() => setMemos([]))
  useEffect(() => {
    reload()
  }, [])

  const remove = async (m: Memo) => {
    if (!confirm(`"${m.title}" 메모를 지울까요?`)) return
    await api.deleteMemo(m.id)
    onDeleted(m.id)
    reload()
  }

  return (
    <Modal title="메모 목록" onClose={onClose}>
      {memos === null && <p className="muted">불러오는 중…</p>}
      {memos?.length === 0 && <p className="muted">저장된 메모가 없어요.</p>}
      <ul className="memo-list">
        {memos?.map((m) => (
          <li key={m.id} className={m.id === currentId ? 'current' : ''}>
            <button className="memo-list-item" onClick={() => onOpen(m.id)}>
              <span className="ellipsis">{m.title}</span>
              <span className="muted small">{formatDate(m.updatedAt)}</span>
            </button>
            <button className="square-btn danger" onClick={() => remove(m)} title="메모 삭제">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
