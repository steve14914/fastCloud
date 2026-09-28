// 로그인 상태를 화면 전체에서 알 수 있게 하는 장치.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler } from './api'
import { clearLoadCache } from './hooks'

type Status = 'checking' | 'in' | 'out'

const AuthContext = createContext<{
  status: Status
  markLoggedIn: () => void
  logout: () => void
}>({ status: 'checking', markLoggedIn: () => {}, logout: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    // 어떤 API든 401(로그인 필요)을 받으면 로그인 화면으로 보낸다
    setUnauthorizedHandler(() => setStatus('out'))
    // 처음 접속했을 때 로그인되어 있는지 확인
    api
      .me()
      .then(() => setStatus('in'))
      .catch(() => setStatus('out'))
  }, [])

  const markLoggedIn = useCallback(() => setStatus('in'), [])
  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      clearLoadCache()
      setStatus('out')
    }
  }, [])

  return <AuthContext.Provider value={{ status, markLoggedIn, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
