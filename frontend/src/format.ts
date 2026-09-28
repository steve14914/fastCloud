// 화면에 보여 줄 숫자/날짜 형식

/** 1536 → "1.5 KB" */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/** 초당 바이트 → "1.2 MB/s" */
export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`
}

/** ISO 날짜 → "9월 28일 14:05" (올해가 아니면 연도도) */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('ko-KR', {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // "오전 05:32" 대신 "05:32"
  })
}
