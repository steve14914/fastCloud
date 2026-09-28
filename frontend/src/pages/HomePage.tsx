import { Link } from 'react-router-dom'
import { FileSection } from '../components/FileSection'
import { Icon } from '../components/Icon'
import { MemoBox } from '../components/MemoBox'
import { UploadBox } from '../components/UploadBox'
import { useRefresh } from '../refresh'
import { useSetUploadTarget } from '../components/Layout'

export function HomePage() {
  const { refresh } = useRefresh()
  // 메인 화면에서 올린 파일은 사진/문서/기타함으로 들어간다
  useSetUploadTarget(undefined)

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="logo">
          <img src="/favicon.svg" alt="" width={28} height={28} /> fastcloud
        </h1>
        <div className="page-header-actions">
          <Link className="btn btn-ghost" to="/files">
            <Icon name="folder" /> 전체 목록
          </Link>
          <button className="btn btn-ghost" onClick={refresh} title="전체 새로고침">
            <Icon name="refresh" /> <span className="hide-mobile">전체 새로고침</span>
          </button>
        </div>
      </header>

      <div className="home-grid">
        <div className="home-memo">
          <MemoBox />
        </div>
        <div className="home-upload">
          <UploadBox />
        </div>
        <FileSection category="photo" />
        <FileSection category="document" />
        <FileSection category="other" />
      </div>
    </div>
  )
}
