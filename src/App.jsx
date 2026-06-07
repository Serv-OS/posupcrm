import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { loadBranding } from './lib/branding';
import Auth from './components/Auth.jsx';
import Shell from './components/Shell.jsx';
import PublicForm from './components/PublicForm.jsx';
import PublicQuote from './components/PublicQuote.jsx';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Public, no-login form route: /f/<slug> (embeddable on any website)
  const formMatch = window.location.pathname.match(/^\/f\/([^/?#]+)/);
  // Public quote route: /q/<token>
  const quoteMatch = window.location.pathname.match(/^\/q\/([^/?#]+)/);

  useEffect(() => {
    loadBranding(); // apply this instance's app name + brand colours
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (formMatch) {
    return <PublicForm slug={decodeURIComponent(formMatch[1])} />;
  }
  if (quoteMatch) {
    return <PublicQuote token={decodeURIComponent(quoteMatch[1])} />;
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Loading…
      </div>
    );
  }

  return session ? <Shell session={session}/> : <Auth/>;
}
