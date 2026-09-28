import type { Folder } from '../api'
import { Icon } from './Icon'
import { Modal } from './Modal'

/**
 * 옮길 폴더를 고르는 창. 폴더들을 트리 모양(들여쓰기)으로 보여 준다.
 * exclude: 폴더를 옮길 때 자기 자신과 그 하위 폴더는 고를 수 없게 뺀다.
 */
export function FolderPicker({
  title,
  folders,
  exclude,
  onPick,
  onClose,
}: {
  title: string
  folders: Folder[]
  exclude?: number
  onPick: (folderId: number | null) => void
  onClose: () => void
}) {
  // parentId별로 자식 폴더를 모아 둔다
  const children = new Map<number | null, Folder[]>()
  for (const f of folders) {
    const list = children.get(f.parentId) ?? []
    list.push(f)
    children.set(f.parentId, list)
  }

  const renderLevel = (parentId: number | null, depth: number): React.ReactNode =>
    (children.get(parentId) ?? [])
      .filter((f) => f.id !== exclude)
      .map((f) => (
        <div key={f.id}>
          <button className="picker-item" style={{ paddingLeft: 12 + depth * 20 }} onClick={() => onPick(f.id)}>
            <Icon name="folder" /> {f.name}
          </button>
          {renderLevel(f.id, depth + 1)}
        </div>
      ))

  return (
    <Modal title={title} onClose={onClose}>
      <div className="picker">
        <button className="picker-item" onClick={() => onPick(null)}>
          <Icon name="stash" /> 영구저장소 맨 위
        </button>
        {renderLevel(null, 1)}
      </div>
    </Modal>
  )
}
