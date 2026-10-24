import { useState } from 'react'

/** Page numbers to show: always first and last, the current page and its neighbours, with gaps as "…". */
export function pageList(page: number, pageCount: number): (number | '…')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('…')
    out.push(p)
  })
  return out
}

/**
 * Client-side paging for lists already in memory. Goes back to page 1 whenever
 * `resetKey` changes (e.g. a new filter), and never points past the last page.
 */
export function usePaged<T>(items: T[], pageSize: number, resetKey: string = '') {
  const [state, setState] = useState({ page: 1, key: resetKey })
  const page = state.key === resetKey ? state.page : 1
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pageCount)
  return {
    page: current,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    setPage: (p: number) => setState({ page: p, key: resetKey }),
    pageSize,
    total: items.length,
  }
}

/** Items per page across the app — small enough to avoid long scrolling. */
export const PAGE_SIZE = 6
