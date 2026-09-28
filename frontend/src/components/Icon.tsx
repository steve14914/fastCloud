// 간단한 선 아이콘 모음 (외부 라이브러리 없이 SVG로 그린다)

const paths = {
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 20V9m0 0l-4 4m4-4l4 4M5 5h14',
  trash: 'M5 7h14M10 7V5h4v2m-7 0l1 12h8l1-12',
  stash: 'M4 8h16v11H4zM3 4h18v4H3zM10 12h4', // 상자 모양 (저장공간으로 보내기)
  unstash: 'M4 8h16v11H4zM3 4h18v4H3zM12 17v-5m0 0l-2 2m2-2l2 2', // 상자에서 꺼내기 (함으로 돌려놓기)
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  close: 'M6 6l12 12M18 6L6 18',
  folder: 'M3 6h6l2 2h10v11H3z',
  folderPlus: 'M3 6h6l2 2h10v11H3zM12 11v5m-2.5-2.5h5',
  move: 'M3 6h6l2 2h10v11H3zM10 13.5h6m0 0l-2-2m2 2l-2 2',
  restore: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  back: 'M15 5l-7 7 7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copyImage: 'M8 8h12v12H8zM16 8V4H4v12h4M8 17l3.5-4 2.5 3 1.5-1.5L20 17',
  format: 'M4 20h4M6 20l5-15h2l5 15M8.5 13h7M16 20h4', // 글자 서식
  checklist: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9',
  bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  highlight: 'M4 20h16M7 16l2-2 7-7-3-3-7 7-2 2 3 3zM14 5l3 3',
  eraser: 'M4 20h16M7 16l-3-3 9-9 6 6-7 7H8zM9 8l6 6',
  check: 'M5 12l4 4 10-10',
  up: 'M12 19V6m0 0l-5 5m5-5l5 5M5 4h14', // 상위 폴더로
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', // 큰 미리보기
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
