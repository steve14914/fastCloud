import { useRef, useState } from 'react'
import { api, fileUrl, type FileItem } from '../api'
import { formatDate } from '../format'
import { Icon } from './Icon'

type Share = { url: string; expiresAt: string }

/**
 * 파일 창 아래쪽의 공유 버튼들: [QR] [사진 복사(사진일 때)] [링크 복사] [다운로드]
 *
 * QR과 복사한 링크는 로그인 안 한 기기에서도 열 수 있어야 하므로, 로그인이 필요한 평소 주소 대신
 * 서버가 만든 공유 링크(추측할 수 없는 주소, 24시간 뒤 만료)를 쓴다. 링크는 처음 필요할 때 한 번만 만든다.
 */
export function ShareBar({ file, canCopyImage }: { file: FileItem; canCopyImage: boolean }) {
  const share = useRef<Promise<Share> | null>(null)
  const [qr, setQr] = useState<{ svg: string; share: Share } | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  const getShare = () => {
    share.current ??= api.createShare(file.id)
    share.current.catch(() => (share.current = null)) // 실패하면 다음에 다시 시도
    return share.current
  }

  const notify = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2500)
  }

  const showQr = async () => {
    if (qr) return setQr(null) // 한 번 더 누르면 닫기
    try {
      // QR 라이브러리는 이 버튼을 처음 누를 때만 받는다 (첫 화면을 가볍게)
      const [s, { default: qrcode }] = await Promise.all([getShare(), import('qrcode-generator')])
      const code = qrcode(0, 'M')
      code.addData(s.url)
      code.make()
      setQr({ svg: code.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), share: s })
    } catch (e) {
      notify((e as Error).message)
    }
  }

  const copyLink = async () => {
    try {
      const s = await getShare()
      await navigator.clipboard.writeText(s.url)
      notify(`다운로드 링크를 복사했어요 (${formatDate(s.expiresAt)}까지 유효)`)
    } catch (e) {
      notify(`복사하지 못했어요: ${(e as Error).message}`)
    }
  }

  const copyImage = async () => {
    try {
      // 클립보드에는 PNG만 넣을 수 있어서, 다른 형식(JPEG 등)은 PNG로 바꿔서 넣는다.
      // Promise를 그대로 넘기면 사진을 받는 동안에도 "사용자가 누른 동작"으로 인정된다 (사파리).
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageAsPng(fileUrl(file.id, true)) })])
      notify('사진을 복사했어요')
    } catch (e) {
      notify(`사진을 복사하지 못했어요: ${(e as Error).message}`)
    }
  }

  return (
    <div className="share-bar">
      {qr && (
        <div className="qr-panel">
          <div className="qr-code" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          <div className="qr-text small">
            <strong>폰 카메라로 찍으면 바로 다운로드돼요</strong>
            <span className="muted">로그인 없이 받을 수 있는 링크예요. {formatDate(qr.share.expiresAt)}까지 유효해요.</span>
          </div>
        </div>
      )}
      <div className="share-buttons">
        <button className={`btn small ${qr ? 'active' : ''}`} onClick={showQr} title="다운로드 링크를 QR 코드로">
          <Icon name="qr" size={16} /> QR
        </button>
        {canCopyImage && (
          <button className="btn small" onClick={copyImage}>
            <Icon name="copyImage" size={16} /> 사진 복사
          </button>
        )}
        <button className="btn small" onClick={copyLink}>
          <Icon name="link" size={16} /> 링크 복사
        </button>
        <a className="btn small" href={fileUrl(file.id)} download>
          <Icon name="download" size={16} /> 다운로드
        </a>
        {toast && <span className="share-toast small">{toast}</span>}
      </div>
    </div>
  )
}

async function imageAsPng(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('변환 실패'))), 'image/png'),
  )
}
