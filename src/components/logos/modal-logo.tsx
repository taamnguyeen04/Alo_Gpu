// Simplified "m" mark inspired by modal.com — fill follows currentColor
export function ModalLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className={className}
      aria-hidden='true'
    >
      <path d='M3 21V9c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.6A6 6 0 0 1 17 3c3.3 0 6 2.7 6 6v12h-4V9c0-1.1-.9-2-2-2s-2 .9-2 2v12h-4V9c0-1.1-.9-2-2-2s-2 .9-2 2v12H3Z' />
      <rect x='2' y='20.2' width='22' height='2.8' rx='1.2' opacity='.35' />
    </svg>
  )
}
