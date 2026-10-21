import React from 'react'

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={['surface rounded-2xl p-4 md:p-6', className].join(' ')}>
      {children}
    </section>
  )
}

