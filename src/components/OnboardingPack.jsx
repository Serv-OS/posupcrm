import { useEffect, useState } from 'react';
import { SECTIONS, visibleFields, missingRequired, summarize, allFiles } from '../lib/onboardingForm';

// The customer's onboarding pack. No login: the token in the URL is the way in.
//
// Written for someone filling this in on a phone between services, so: one
// section at a time, progress they can see, answers kept as they go, and files
// uploaded the moment they are picked (a 20MB menu PDF should not be waiting on
// the Submit button). Nothing here talks to the database directly — every call
// goes through the onboarding-form function.

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboarding-form`;
const call = async (payload) => {
  const res = await fetch(FN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
};

export default function OnboardingPack({ token }) {
  const [state, setState] = useState({ loading: true, error: '', venue: '', submitted: false });
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await call({ token, action: 'load' });
        setAnswers(d.answers || {});
        setState({ loading: false, error: '', venue: d.venue || '', submitted: !!d.submitted });
      } catch (e) {
        setState({ loading: false, error: e.message, venue: '', submitted: false });
      }
    })();
  }, [token]);

  const section = SECTIONS[step];
  const a = answers[section?.key] || {};
  const set = (fieldKey, value) =>
    setAnswers((prev) => ({ ...prev, [section.key]: { ...(prev[section.key] || {}), [fieldKey]: value } }));

  const missing = missingRequired(answers);
  const missingHere = section
    ? missing.filter((m) => m.section === section.title).length
    : 0;

  // Upload as soon as a file is chosen: straight to storage via a signed URL.
  const upload = async (field, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading((u) => ({ ...u, [field.key]: true }));
    try {
      const stored = [];
      for (const file of files) {
        const { path, signedUrl, name } = await call({
          token, action: 'upload-url', fileName: file.name, size: file.size,
        });
        const put = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        if (!put.ok) throw new Error(`Could not upload ${file.name}.`);
        stored.push({ name, path, size: file.size, mime: file.type || null });
      }
      const existing = a[field.key];
      const prev = Array.isArray(existing) ? existing : existing ? [existing] : [];
      set(field.key, field.multiple ? [...prev, ...stored] : stored[0]);
    } catch (e) {
      alert(e.message);
    }
    setUploading((u) => ({ ...u, [field.key]: false }));
  };

  const removeFile = (field, path) => {
    const v = a[field.key];
    if (field.multiple) set(field.key, (Array.isArray(v) ? v : []).filter((f) => f.path !== path));
    else set(field.key, null);
  };

  const submit = async () => {
    if (missing.length) { setShowMissing(true); return; }
    setSubmitting(true);
    try {
      await call({ token, action: 'submit', answers, files: allFiles(answers), summary: summarize(answers) });
      setState((s) => ({ ...s, submitted: true }));
      window.scrollTo(0, 0);
    } catch (e) { alert(e.message); }
    setSubmitting(false);
  };

  if (state.loading) return <Frame><div className="text-center text-slate-500 py-16">Loading…</div></Frame>;
  if (state.error) return <Frame><div className="text-center py-16"><div className="text-3xl mb-3">🔒</div><div className="text-slate-700">{state.error}</div></div></Frame>;
  if (state.submitted) return (
    <Frame>
      <div className="text-center py-14">
        <div className="text-4xl mb-4">✅</div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Thank you, that's everything we need</h1>
        <p className="text-slate-600 text-sm max-w-md mx-auto">
          Your onboarding pack is with our team{state.venue ? ` for ${state.venue}` : ''}. We'll be in touch if anything needs
          clarifying, and you'll hear from us with next steps shortly.
        </p>
      </div>
    </Frame>
  );

  const input = "w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[15px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

  return (
    <Frame>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Onboarding pack</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          {state.venue ? <>Setting up <span className="font-semibold text-slate-800">{state.venue}</span>. </> : null}
          Everything here goes straight into building your till. It saves as you go, so you can stop and come back.
        </p>
      </div>

      {/* Progress: every section, tappable, with what's still owed */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {SECTIONS.map((s, i) => {
          const owed = missing.filter((m) => m.section === s.title).length;
          const active = i === step;
          return (
            <button key={s.key} onClick={() => { setStep(i); window.scrollTo(0, 0); }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                active ? 'bg-slate-900 text-white border-slate-900'
                  : owed ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {i + 1}. {s.title}{owed ? ` · ${owed}` : ' ✓'}
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="mb-4">
          <div className="text-base font-bold text-slate-900">{section.title}</div>
          {section.hint && <div className="text-xs text-slate-500 mt-0.5">{section.hint}</div>}
        </div>

        <div className="space-y-4">
          {visibleFields(section, answers).map((f) => {
            const v = a[f.key];
            const files = Array.isArray(v) ? v : v ? [v] : [];
            return (
              <div key={f.key}>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {f.hint && <div className="text-xs text-slate-500 mb-1.5 whitespace-pre-line">{f.hint}</div>}

                {f.type === 'text' && <input className={input} value={v || ''} onChange={(e) => set(f.key, e.target.value)} />}
                {f.type === 'textarea' && <textarea rows={5} className={input + ' resize-y'} value={v || ''} onChange={(e) => set(f.key, e.target.value)} />}
                {f.type === 'choice' && (
                  <div className="flex flex-wrap gap-2">
                    {f.options.map((o) => (
                      <button key={o} type="button" onClick={() => set(f.key, v === o ? '' : o)}
                        className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition ${
                          v === o ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {f.type === 'file' && (
                  <div>
                    {files.length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {files.map((file) => (
                          <div key={file.path} className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                            <span className="text-base">📎</span>
                            <span className="text-sm text-slate-800 truncate flex-1">{file.name}</span>
                            <span className="text-[11px] text-slate-400 font-mono shrink-0">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                            <button onClick={() => removeFile(f, file.path)} className="text-slate-400 hover:text-red-600 text-lg leading-none shrink-0">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <label className={`flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition ${
                      uploading[f.key] ? 'border-slate-200 text-slate-400' : 'border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900'}`}>
                      <input type="file" className="hidden" multiple={!!f.multiple} disabled={!!uploading[f.key]}
                        onChange={(e) => { upload(f, e.target.files); e.target.value = ''; }} />
                      <span className="text-sm font-semibold">
                        {uploading[f.key] ? 'Uploading…' : files.length ? 'Add another file' : 'Choose file'}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Move through the pack */}
      <div className="flex items-center gap-2 mt-4">
        <button disabled={step === 0} onClick={() => { setStep((s) => s - 1); window.scrollTo(0, 0); }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 disabled:opacity-30 hover:bg-slate-100">Back</button>
        {missingHere > 0 && <span className="text-xs text-amber-700">{missingHere} still needed here</span>}
        {step < SECTIONS.length - 1 ? (
          <button onClick={() => { setStep((s) => s + 1); window.scrollTo(0, 0); }}
            className="ml-auto px-5 py-2.5 rounded-xl text-sm font-bold bg-slate-900 text-white hover:bg-slate-800">Next</button>
        ) : (
          <button disabled={submitting} onClick={submit}
            className="ml-auto px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Send to our team'}
          </button>
        )}
      </div>

      {showMissing && missing.length > 0 && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="text-xs font-bold text-amber-800 mb-1">Still needed before you can send:</div>
          <ul className="text-xs text-amber-800 space-y-0.5">
            {missing.map((m, i) => <li key={i}>{m.section} — {m.field}</li>)}
          </ul>
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4">
      <div className="max-w-2xl mx-auto">{children}</div>
    </div>
  );
}
