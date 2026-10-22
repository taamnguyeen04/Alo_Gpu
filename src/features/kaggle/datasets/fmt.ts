// Shared formatting helpers for the Kaggle Datasets page

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${u === 0 ? v.toFixed(0) : v.toFixed(1)}${units[u]}`
}
