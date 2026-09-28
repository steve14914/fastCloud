import { useRef } from 'react'
import { useUpload, type UploadTarget } from '../upload'
import { Icon } from './Icon'

/**
 * 파일을 끌어다 놓거나 눌러서 고르는 업로드 상자.
 * 끌어다 놓기는 화면 전체(Layout)에서 받으므로, 이 상자는 "여기 놓으면 된다"는 안내와 파일 선택 역할을 한다.
 */
export function UploadBox({ target, hint }: { target?: UploadTarget; hint?: string }) {
  return (
    <label className="dropzone">
      <Icon name="upload" size={28} />
      <strong>여기로 파일을 끌어다 놓거나 눌러서 선택</strong>
      <span className="muted small">{hint ?? 'PC에서는 Ctrl+V로 붙여넣어도 올라가요'}</span>
      <FileInput target={target} />
    </label>
  )
}

/** 숨겨진 파일 선택 input. label 안에 두면 label을 눌렀을 때 파일 선택 창이 열린다. */
function FileInput({ target }: { target?: UploadTarget }) {
  const { upload } = useUpload()
  return (
    <input
      type="file"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files) upload(e.target.files, target)
        e.target.value = '' // 같은 파일을 다시 골라도 onChange가 불리게
      }}
    />
  )
}

/** 파일 선택 창을 여는 버튼 */
export function UploadButton({ target, className = 'btn btn-primary', label = '파일 올리기' }: {
  target?: UploadTarget
  className?: string
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const { upload } = useUpload()
  return (
    <>
      <button className={className} onClick={() => input.current?.click()} title="파일 올리기">
        <Icon name="upload" />
        {label && <span>{label}</span>}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) upload(e.target.files, target)
          e.target.value = ''
        }}
      />
    </>
  )
}
