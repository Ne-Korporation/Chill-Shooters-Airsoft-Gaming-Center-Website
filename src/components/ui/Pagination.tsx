import React, { useEffect, useMemo, useState } from 'react'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'

export const DEFAULT_PAGE_SIZE = 10

// Pages through an already-filtered list. Filters run over the whole list first, so a match on
// page 3 is never hidden behind page 1; the page snaps back to 1 whenever `resetKey` changes.
export function usePagination<T>(items: ReadonlyArray<T>, pageSize = DEFAULT_PAGE_SIZE, resetKey?: unknown) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  )

  return { page, setPage, pageCount, pageItems, total: items.length, pageSize }
}

// Renders one page of `items` through `children`, with the page controls underneath. For lists
// that aren't inside a <table> (a <nav> can't sit in a <tbody>; use usePagination there).
export function Paged<T>({
  items,
  pageSize = DEFAULT_PAGE_SIZE,
  resetKey,
  children,
}: {
  items: ReadonlyArray<T>
  pageSize?: number
  resetKey?: unknown
  children: (pageItems: T[]) => React.ReactNode
}) {
  const { page, setPage, pageCount, pageItems, total } = usePagination(items, pageSize, resetKey)
  return (
    <>
      {children(pageItems)}
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={setPage} />
    </>
  )
}

// "‹ 7 / 10 ›" with the range shown, e.g. "Showing 61–70 of 97".
export function Pagination({
  page,
  pageCount,
  total,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageChange,
  className = '',
}: {
  page: number
  pageCount: number
  total: number
  pageSize?: number
  onPageChange: (page: number) => void
  className?: string
}) {
  if (total <= pageSize) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  const buttonClass =
    'surface hover-row inline-flex h-8 w-8 items-center justify-center rounded-lg text-text transition disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-accent/40'

  return (
    <nav aria-label="Pagination" className={['flex items-center justify-between gap-3 px-1 py-3 text-xs text-muted', className].join(' ')}>
      <span>
        Showing {first}–{last} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <FiChevronLeft />
        </button>
        <span className="min-w-[3.5rem] text-center font-semibold text-text">
          {page} / {pageCount}
        </span>
        <button type="button" className={buttonClass} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <FiChevronRight />
        </button>
      </div>
    </nav>
  )
}
