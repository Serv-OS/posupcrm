import { useEffect, useState } from 'react';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/forms-public`;

export default function PublicForm({ slug }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const src = new URLSearchParams(window.location.search).get('src');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${FN_URL}?slug=${encodeURIComponent(slug)}`);
        const d = await res.json();
        if (!res.ok) { setError(d.error || 'Form not found.'); }
        else setForm(d.form);
      } catch {
        setError('Could not load this form.');
      }
      setLoading(false);
    })();
  }, [slug]);

  const setVal = (k, v) => setValues(prev => ({ ...prev, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          data: values,
          src,
          page_url: document.referrer || window.location.href,
          referrer: document.referrer || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Something went wrong.'); setSubmitting(false); return; }
      if (d.redirect_url) { window.location.href = d.redirect_url; return; }
      setForm(f => ({ ...f, _successMessage: d.message }));
      setDone(true);
    } catch {
      setError('Could not submit. Please try again.');
    }
    setSubmitting(false);
  };

  const wrap = (children) => (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        {children}
      </div>
    </div>
  );

  if (loading) return wrap(<div className="text-center text-slate-400 text-sm py-8">Loading…</div>);
  if (error && !form) return wrap(<div className="text-center text-slate-600 text-sm py-8">{error}</div>);

  if (done) return wrap(
    <div className="text-center py-6">
      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl mx-auto mb-3">✓</div>
      <div className="text-lg font-bold text-slate-800 mb-1">Thank you</div>
      <div className="text-sm text-slate-500">{form?._successMessage || "We'll be in touch shortly."}</div>
    </div>
  );

  const input = "w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent";
  const label = "block text-xs font-semibold text-slate-600 mb-1";

  return wrap(
    <form onSubmit={submit} className="space-y-4">
      <div>
        <div className="text-xl font-bold text-slate-800">{form.name}</div>
        {form.description && <div className="text-sm text-slate-500 mt-1">{form.description}</div>}
      </div>

      {(form.fields || []).map(f => (
        <div key={f.key}>
          <label className={label}>{f.label}{f.required && <span className="text-orange-500"> *</span>}</label>
          {f.type === 'textarea' ? (
            <textarea className={input + ' resize-none'} rows={4} required={f.required}
              placeholder={f.placeholder || ''} value={values[f.key] || ''}
              onChange={e => setVal(f.key, e.target.value)} />
          ) : f.type === 'select' ? (
            <select className={input} required={f.required} value={values[f.key] || ''}
              onChange={e => setVal(f.key, e.target.value)}>
              <option value="">{f.placeholder || 'Select…'}</option>
              {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className={input} type={f.type || 'text'} required={f.required}
              placeholder={f.placeholder || ''} value={values[f.key] || ''}
              onChange={e => setVal(f.key, e.target.value)} />
          )}
        </div>
      ))}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <button type="submit" disabled={submitting}
        className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
        {submitting ? 'Sending…' : (form.settings?.submit_label || 'Submit')}
      </button>

      <div className="text-center text-[10px] text-slate-300 pt-1">Powered by ServOS</div>
    </form>
  );
}
