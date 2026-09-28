import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

// 구글 로그인이 실패해서 돌아왔을 때 주소에 붙는 ?error= 값별 안내 문구
const googleErrors: Record<string, string> = {
  not_allowed: '허용되지 않은 구글 계정이에요.',
  cancelled: '구글 로그인을 취소했어요.',
  state: '로그인 요청이 만료됐어요. 다시 시도해 주세요.',
  too_many: '로그인 시도가 너무 많아요. 잠시 후 다시 시도하세요.',
  google_disabled: '구글 로그인이 설정되지 않았어요.',
}

export function LoginPage() {
  const { markLoggedIn } = useAuth()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() => {
    const e = params.get('error')
    return e ? (googleErrors[e] ?? '구글 로그인에 실패했어요.') : ''
  })
  const [busy, setBusy] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  useEffect(() => {
    api
      .authConfig()
      .then((c) => setGoogleEnabled(c.google))
      .catch(() => {})
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault() // 폼 제출 시 페이지가 새로고침되지 않게
    setBusy(true)
    setError('')
    try {
      await api.login(username, password)
      markLoggedIn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="login-logo">
          <img src="/favicon.svg" alt="" width={36} height={36} /> fastcloud
        </h1>
        {googleEnabled && (
          <>
            {/* 일반 링크로 이동해야 구글 로그인 화면으로 넘어갔다가 돌아올 수 있다 */}
            <a className="btn btn-google" href="/api/auth/google/start">
              <GoogleLogo /> 구글로 로그인
            </a>
            <div className="divider">
              <span>또는</span>
            </div>
          </>
        )}
        <label className="field">
          <span>아이디</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
