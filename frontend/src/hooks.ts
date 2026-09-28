import { useEffect, useState } from 'react'
import { useRefresh } from './refresh'

// 마지막으로 불러온 결과를 key별로 기억해 둔다.
// 다른 화면에 갔다가 돌아오면 기억해 둔 목록을 즉시 보여 주고, 뒤에서 새로 불러와 바꾼다.
const cache = new Map<string, unknown>()

/**
 * 서버에서 데이터를 불러오는 공통 훅.
 * key: 이 데이터의 이름 (캐시에 쓰임). key가 바뀌거나 전체 새로고침(refresh)이 일어나면 다시 불러온다.
 * reload()를 부르면 이 목록만 다시 불러온다.
 */
export function useLoad<T>(key: string, load: () => Promise<T>) {
  const { version } = useRefresh()
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T) ?? null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false // 응답이 오기 전에 화면이 바뀌면 결과를 버린다
    if (cache.has(key)) setData(cache.get(key) as T)
    load()
      .then((d) => {
        cache.set(key, d)
        if (!cancelled) {
          setData(d)
          setError('')
        }
      })
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // load는 매번 새로 만들어지는 함수라서 key로 바뀜을 판단한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, nonce])

  return { data, error, reload: () => setNonce((n) => n + 1) }
}

/** 로그아웃할 때 다른 계정 데이터가 남지 않도록 비운다 */
export function clearLoadCache() {
  cache.clear()
}
