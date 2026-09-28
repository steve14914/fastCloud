// "목록을 다시 불러와야 한다"는 신호를 화면 전체에 알리는 장치.
//
// 파일을 올리거나 지우거나 옮기면 refresh()를 부른다. 그러면 version 숫자가 1 올라가고,
// version을 쓰는 모든 목록(사진함, 문서함, 용량 표시 등)이 알아서 다시 불러온다.

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const RefreshContext = createContext({ version: 0, refresh: () => {} })

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  return <RefreshContext.Provider value={{ version, refresh }}>{children}</RefreshContext.Provider>
}

export function useRefresh() {
  return useContext(RefreshContext)
}
