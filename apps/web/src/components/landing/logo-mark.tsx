/** Zethos mark: two rounded, offset parallelogram bars forming an abstract "Z" (two order flows meeting). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 32 32"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11 5.5 H28.5 L22.5 13.5 H5Z" />
      <path d="M9.5 18.5 H27 L21 26.5 H3.5Z" />
    </svg>
  );
}
