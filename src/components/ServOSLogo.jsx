export function LogoMark({ size = 32, className = '' }) {
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} className={className}>
      <rect x="4" y="4" width="72" height="72" rx="14" fill="#E8743C"/>
      <path d="M22 25 Q22 20 27 20 L53 20 Q58 20 58 25 L58 36 Q58 40 54 40 L26 40 Q22 40 22 44 L22 55 Q22 60 27 60 L53 60 Q58 60 58 55"
            fill="none" stroke="#0E0D0A" strokeWidth="6" strokeLinecap="square"/>
    </svg>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`font-display text-2xl tracking-tight ${className}`} style={{ lineHeight: 0.9 }}>
      Serv<span className="text-ember italic">OS</span>
    </span>
  );
}

export function LogoLockup({ size = 28, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size}/>
      <Wordmark/>
    </div>
  );
}
