// Simplified "K" monogram inspired by kaggle.com — fill follows currentColor
export function KaggleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='currentColor'
      className={className}
      aria-hidden='true'
    >
      <path d='M7.5 2h3.2v8.7L17.3 2h3.9l-7.6 10 7.3 10h-4.1l-6.1-8.4v8.4H7.5V2Z' />
    </svg>
  )
}
