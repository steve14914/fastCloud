// 파일 종류별로 어떤 미리보기를 할 수 있는지 정한다.

import type { FileItem } from './api'

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// 텍스트로 열어 볼 수 있는 확장자
const textExts = new Set([
  'txt', 'md', 'csv', 'tsv', 'log', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
  'py', 'go', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rs', 'rb', 'php', 'lua', 'dart', 'scala', 'r',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql', 'gradle', 'properties', 'gitignore', 'dockerfile',
  'srt', 'vtt', 'smi',
])

// 브라우저가 보여 줄 수 있는 사진 형식 (heic 등은 대부분 브라우저가 못 연다)
const viewableImageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg'])

export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'none'

export function previewKind(file: FileItem): PreviewKind {
  const ext = extensionOf(file.name)
  if (viewableImageExts.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (textExts.has(ext) || file.contentType.startsWith('text/')) return 'text'
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio'
  return 'none'
}

export const categoryLabels = {
  photo: '사진함',
  document: '문서함',
  other: '기타파일함',
} as const
