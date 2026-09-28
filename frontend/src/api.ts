// 백엔드 API를 부르는 함수들을 한곳에 모아 둔다.
// 화면 코드에서는 fetch를 직접 쓰지 않고 여기 있는 함수만 쓴다.

export type Category = 'photo' | 'document' | 'other'

export interface FileItem {
  id: number
  name: string
  size: number
  contentType: string
  category: Category
  folderId: number | null
  stashed: boolean // false: 사진/문서/기타함에 있음, true: 저장공간(폴더 정리 영역)에 있음
  createdAt: string
  deletedAt: string | null
}

export interface Folder {
  id: number
  name: string
  parentId: number | null
  createdAt: string
}

export interface Memo {
  id: number
  title: string
  body?: string
  createdAt: string
  updatedAt: string
}

export interface Usage {
  usedBytes: number
  trashBytes: number
  fileCount: number
  diskTotal: number
  diskFree: number
}

/** 서버가 에러를 돌려줬을 때 던지는 에러. status로 401 등을 구분할 수 있다. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 로그인이 풀렸을 때(401) 호출할 함수. App.tsx에서 등록한다. */
let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`
    try {
      message = (await res.json()).error ?? message
    } catch {
      // 본문이 JSON이 아니면 기본 메시지를 쓴다
    }
    if (res.status === 401 && path !== '/api/login') onUnauthorized()
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  // 로그인
  me: () => request<{ loggedIn: boolean }>('GET', '/api/me'),
  authConfig: () => request<{ google: boolean }>('GET', '/api/auth/config'),
  login: (username: string, password: string) => request<void>('POST', '/api/login', { username, password }),
  logout: () => request<void>('POST', '/api/logout'),

  // 파일
  listFiles: (params: {
    view?: 'all' | 'home' | 'stash' | 'trash'
    category?: Category
    folder?: number | 'root'
    limit?: number
  }) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v))
    return request<{ files: FileItem[] }>('GET', `/api/files?${q}`).then((r) => r.files)
  },
  updateFile: (id: number, changes: { name?: string; folderId?: number | null; stashed?: boolean }) =>
    request<FileItem>('PATCH', `/api/files/${id}`, changes),
  trashFile: (id: number) => request<void>('DELETE', `/api/files/${id}`),
  deleteForever: (id: number) => request<void>('DELETE', `/api/files/${id}?permanent=1`),
  restoreFile: (id: number) => request<void>('POST', `/api/files/${id}/restore`),
  emptyTrash: () => request<void>('DELETE', '/api/trash'),

  // 폴더
  listFolders: () => request<{ folders: Folder[] }>('GET', '/api/folders').then((r) => r.folders),
  createFolder: (name: string, parentId: number | null) => request<Folder>('POST', '/api/folders', { name, parentId }),
  renameFolder: (id: number, name: string) => request<void>('PATCH', `/api/folders/${id}`, { name }),
  moveFolder: (id: number, parentId: number | null) => request<void>('PATCH', `/api/folders/${id}`, { parentId }),
  deleteFolder: (id: number) => request<void>('DELETE', `/api/folders/${id}`),

  // 메모
  listMemos: () => request<{ memos: Memo[] }>('GET', '/api/memos').then((r) => r.memos),
  getMemo: (id: number) => request<Memo>('GET', `/api/memos/${id}`),
  createMemo: (body: string) => request<Memo>('POST', '/api/memos', { body }),
  updateMemo: (id: number, body: string) => request<Memo>('PUT', `/api/memos/${id}`, { body }),
  deleteMemo: (id: number) => request<void>('DELETE', `/api/memos/${id}`),

  // 상태
  usage: () => request<Usage>('GET', '/api/usage'),
  transferStats: () => request<{ uploadBps: number; downloadBps: number }>('GET', '/api/stats/transfer'),
}

/** 사진 썸네일 주소 (256px 정사각형 JPEG, 수십 KB) */
export function thumbUrl(id: number) {
  return `/api/files/${id}/thumb`
}

/** 파일 다운로드 주소. inline이면 브라우저에서 바로 연다 (사진 미리보기 등). */
export function fileUrl(id: number, inline = false) {
  return `/api/files/${id}${inline ? '?inline=1' : ''}`
}

/**
 * 파일 하나를 올린다. fetch는 업로드 진행률을 알려 주지 않아서 XMLHttpRequest를 쓴다.
 * folder: 없으면 사진/문서/기타함, 'root'면 저장공간 맨 위, 숫자면 그 폴더.
 */
export function uploadFile(
  file: File,
  folder: number | 'root' | undefined,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<FileItem>; cancel: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<FileItem>((resolve, reject) => {
    const q = folder === undefined ? '' : `?folder=${folder}`
    xhr.open('POST', `/api/files${q}`)
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total)
    xhr.onload = () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText).files[0])
        return
      }
      if (xhr.status === 401) onUnauthorized()
      let message = `업로드 실패 (${xhr.status})`
      try {
        message = JSON.parse(xhr.responseText).error ?? message
      } catch {
        // 무시
      }
      reject(new ApiError(xhr.status, message))
    }
    xhr.onerror = () => reject(new ApiError(0, '네트워크 오류'))
    xhr.onabort = () => reject(new ApiError(0, '취소됨'))
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
  return { promise, cancel: () => xhr.abort() }
}

/**
 * 텍스트 미리보기용으로 파일 앞부분(최대 maxBytes)을 읽는다.
 * Range 요청으로 앞부분만 받아서 큰 파일도 빠르다.
 * UTF-8이 아니면 윈도우 메모장에서 자주 쓰는 EUC-KR(CP949)로 다시 읽어 본다.
 */
export async function readTextPreview(id: number, maxBytes = 512 * 1024) {
  const res = await fetch(fileUrl(id, true), { headers: { Range: `bytes=0-${maxBytes - 1}` } })
  if (!res.ok) throw new ApiError(res.status, '파일을 읽지 못했습니다')
  const buf = await res.arrayBuffer()
  const total = Number(res.headers.get('Content-Range')?.split('/')[1] ?? buf.byteLength)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // 잘린 끝부분 때문에 실패했을 수도 있으니, 한 번 더 너그럽게 UTF-8로 읽어서 깨진 글자가 적으면 그걸 쓴다
    const loose = new TextDecoder('utf-8').decode(buf)
    const broken = (loose.slice(0, -4).match(/�/g) ?? []).length
    text = broken === 0 ? loose : new TextDecoder('euc-kr').decode(buf)
  }
  return { text, truncated: total > buf.byteLength }
}
