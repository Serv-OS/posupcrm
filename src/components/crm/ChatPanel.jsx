import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useGoogleConnection } from '../../lib/useGoogle';
import { MessageSquare, RefreshCw, Send, Users, User, CheckSquare, Hash } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-chat`;

const fmtTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const today = new Date().toDateString() === dt.toDateString();
  return today ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function ChatPanel({ profile, onNavigate }) {
  const { connected, connect } = useGoogleConnection(profile.id);
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null); // selected space
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [taskMsg, setTaskMsg] = useState('');
  const endRef = useRef(null);

  const callFn = useCallback(async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Request failed');
    return d;
  }, []);

  const loadSpaces = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await callFn({ action: 'spaces' }); setSpaces(d.spaces || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, [callFn]);

  useEffect(() => { if (connected) loadSpaces(); }, [connected, loadSpaces]);

  const openSpace = useCallback(async (s) => {
    setActive(s); setMsgLoading(true); setMessages([]); setTaskMsg('');
    try { const d = await callFn({ action: 'messages', space: s.name }); setMessages(d.messages || []); }
    catch (e) { setError(e.message); }
    setMsgLoading(false);
    setTimeout(() => endRef.current?.scrollIntoView(), 50);
  }, [callFn]);

  const send = async () => {
    if (!draft.trim() || !active) return;
    setSending(true); setError('');
    try {
      await callFn({ action: 'send', space: active.name, text: draft });
      setDraft('');
      const d = await callFn({ action: 'messages', space: active.name });
      setMessages(d.messages || []);
      setTimeout(() => endRef.current?.scrollIntoView(), 50);
    } catch (e) { setError(e.message); }
    setSending(false);
  };

  const taskFromMessage = async (m) => {
    const { data: t } = await supabase.from('tasks').insert({
      title: (m.text || 'Chat follow-up').slice(0, 120),
      description: `${m.text || ''}\n\n(From Google Chat — ${active?.displayName || ''}, ${m.sender})`,
      priority: 'P2', owner_id: profile.id,
    }).select('id').single();
    if (t) { setTaskMsg(t.id); setTimeout(() => setTaskMsg(''), 4000); }
  };

  if (connected === null) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading chat…</div>;

  if (connected === false) return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-14 h-14 rounded-2xl glass-inner flex items-center justify-center mb-4"><MessageSquare size={26} className="text-ember" /></div>
      <div className="text-lg font-bold text-paper mb-1">Connect Google Chat</div>
      <div className="text-sm text-muted max-w-sm mb-4">Link your Google account to read and reply to your Chat spaces and DMs right here.</div>
      <button onClick={connect} className="btn-glass px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"><MessageSquare size={16} /> Connect Google</button>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 shrink-0">
        <MessageSquare size={20} className="text-ember" />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper leading-tight">Chat</div>
          <div className="text-[11px] text-muted truncate">{connected.email}</div>
        </div>
        <button onClick={loadSpaces} title="Refresh" className="btn-ghost p-2 rounded-xl"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {error && <div className="mx-6 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</div>}

      <div className="flex-1 min-h-0 flex">
        {/* Spaces list */}
        <div className={`${active ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[300px] md:border-r border-bdr overflow-y-auto`}>
          {loading && !spaces.length ? <div className="p-6 text-center text-dim text-sm">Loading…</div>
            : spaces.length === 0 ? <div className="p-6 text-center text-dim text-sm">No chats found.</div>
            : spaces.map(s => {
              const dm = s.type === 'DIRECT_MESSAGE';
              return (
                <button key={s.name} onClick={() => openSpace(s)}
                  className={`text-left px-4 py-3 border-b border-bdr/60 flex items-center gap-3 transition ${active?.name === s.name ? 'bg-ember/10' : 'hover:bg-card'}`}>
                  <div className="w-9 h-9 rounded-full glass-inner flex items-center justify-center shrink-0">
                    {dm ? <User size={16} className="text-muted" /> : <Hash size={16} className="text-muted" />}
                  </div>
                  <div className="text-sm font-medium text-paper truncate">{s.displayName}</div>
                </button>
              );
            })}
        </div>

        {/* Conversation */}
        <div className={`${active ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
          {!active ? (
            <div className="h-full flex items-center justify-center text-dim text-sm">Select a chat</div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-bdr flex items-center gap-3 shrink-0">
                <button onClick={() => setActive(null)} className="md:hidden text-muted hover:text-paper text-lg">&larr;</button>
                <div className="w-8 h-8 rounded-full glass-inner flex items-center justify-center shrink-0">
                  {active.type === 'DIRECT_MESSAGE' ? <User size={15} className="text-muted" /> : <Users size={15} className="text-muted" />}
                </div>
                <div className="text-sm font-bold text-paper truncate">{active.displayName}</div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {msgLoading ? <div className="text-center text-dim text-sm py-6">Loading…</div>
                  : messages.length === 0 ? <div className="text-center text-dim text-sm py-6">No messages.</div>
                  : messages.map(m => (
                    <div key={m.name} className="group flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-paper">{m.sender}</span>
                        <span className="text-[10px] text-dim">{fmtTime(m.createTime)}</span>
                        <button onClick={() => taskFromMessage(m)} title="Create task from this message"
                          className="opacity-0 group-hover:opacity-100 transition text-[10px] text-violet-600 flex items-center gap-0.5 ml-auto">
                          <CheckSquare size={11} /> Task
                        </button>
                      </div>
                      <div className="text-sm text-paper whitespace-pre-wrap break-words">{m.text || <span className="text-dim italic">(no text)</span>}</div>
                    </div>
                  ))}
                <div ref={endRef} />
              </div>

              {taskMsg && (
                <div className="px-5 py-1.5 text-xs text-emerald-600 bg-emerald-50 border-t border-emerald-100 flex items-center gap-2">
                  Task created. <button onClick={() => onNavigate?.('task', taskMsg)} className="underline font-medium">Open task</button>
                </div>
              )}

              <div className="px-4 py-3 border-t border-bdr shrink-0 flex items-end gap-2">
                <textarea rows={1} value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Message…" className="flex-1 px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none max-h-32" />
                <button onClick={send} disabled={sending || !draft.trim()} className="btn-glass p-2.5 rounded-xl disabled:opacity-50"><Send size={16} /></button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
