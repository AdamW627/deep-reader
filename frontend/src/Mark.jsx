export default function Mark({ size = 30, className = 'brandmark' }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="6"/>
    <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="miter">
      <path d="M12 16H23L31 24V36L23 44H12Z"/>
      <path d="M38 44V16H48L53 21V27L48 32H38M45 32L52 44"/>
      <path d="M12 51H53" strokeWidth="2.2" opacity=".55"/>
    </g>
  </svg>;
}
