import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

/** 화면 위에 뜨는 창. 바깥을 누르거나 Esc를 누르면 닫힌다. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode // 창 아래쪽에 고정되는 부분 (스크롤되지 않음)
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // 창이 떠 있는 동안 뒤 화면이 스크롤되지 않게 한다
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" onClick={onClose} title="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer}
      </div>
    </div>
  )
}
