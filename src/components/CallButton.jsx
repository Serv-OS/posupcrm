import { callNumber } from '../lib/phone';

// One-click call button. Drop it next to any phone number anywhere in the app.
// variant="icon"   -> compact phone glyph (for tight rows/cards)
// variant="full"   -> "Call" pill with label (default)
export default function CallButton({ number, variant = 'full', className = '', title }) {
  if (!number) return null;

  const onClick = (e) => {
    e.stopPropagation();
    callNumber(number);
  };

  if (variant === 'icon') {
    return (
      <button onClick={onClick} title={title || `Call ${number}`}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 transition shrink-0 ${className}`}>
        {'\u{1F4DE}'}
      </button>
    );
  }

  return (
    <button onClick={onClick} title={title || `Call ${number}`}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 transition shrink-0 ${className}`}>
      {'\u{1F4DE}'} Call
    </button>
  );
}
