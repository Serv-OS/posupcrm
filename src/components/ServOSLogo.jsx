export function LogoMark({ size = 32, className = '' }) {
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} className={className}>
      <rect x="4" y="4" width="72" height="72" rx="16" fill="#E8743C"/>
      {/* Squared "2" glyph */}
      <path d="M25 29 Q25 20 35 20 L47 20 Q57 20 57 31 Q57 40 47 47 L29 58 L58 58"
            fill="none" stroke="#0E0D0A" strokeWidth="9" strokeLinecap="square" strokeLinejoin="round"/>
    </svg>
  );
}

export function Wordmark({ className = '', fontSize }) {
  return (
    <span className={`font-display tracking-tight ${fontSize ? '' : 'text-2xl'} ${className}`}
      style={{ lineHeight: 0.9, fontSize: fontSize ? `${fontSize}px` : undefined }}>
      Serv<span className="text-ember italic">OS</span>
    </span>
  );
}

export function LogoLockup({ size = 28, className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size}/>
      <Wordmark fontSize={Math.round(size * 0.95)}/>
    </div>
  );
}
