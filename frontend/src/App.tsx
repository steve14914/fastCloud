import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { FilesPage } from './pages/FilesPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { TrashPage } from './pages/TrashPage'
import { RefreshProvider } from './refresh'
import { SelectionProvider } from './selection'
import { UploadProvider } from './upload'

export function App() {
  const { status } = useAuth()

  if (status === 'checking') return <div className="splash">불러오는 중…</div>

  // 로그인 안 되어 있으면 어떤 주소로 들어와도 로그인 화면
  if (status === 'out') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <RefreshProvider>
      <UploadProvider>
        <SelectionProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="/trash" element={<TrashPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SelectionProvider>
      </UploadProvider>
    </RefreshProvider>
  )
}
