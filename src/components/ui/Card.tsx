import React from 'react'

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={['rounded-2xl glass border border-white/5 p-4 md:p-6', className].join(' ')}>
      {children}
    </section>
  )
}

