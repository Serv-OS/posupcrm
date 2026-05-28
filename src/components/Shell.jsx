import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Sidebar from './Sidebar.jsx';
import Board from './Board.jsx';
import UsersPanel from './UsersPanel.jsx';
import FeaturesPanel from './FeaturesPanel.jsx';
import ItemDetail from './ItemDetail.jsx';

export default function Shell({ session }) {
  const [profile, setProfile]   = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [view, setView]         = useState('board');
  const [openItem, setOpenItem] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      setProfile(data);
    })();
  }, [session.user.id]);

  useEffect(() => {
    load();
    const ch = supabase.channel('projects')
      .on('postgres_changes', { event:'*', schema:'public', table:'projects' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const load = async () => {
    const { data } = await supabase.from('projects').select('*').eq('archived', false).order('created_at');
    setProjects(data || []);
    if (!activeProject && data?.length) setActiveProject(data[0]);
  };

  const signOut = () => supabase.auth.signOut();

  if (!profile) return <div className="h-full flex items-center justify-center text-muted text-sm">Loading profile…</div>;

  return (
    <div className="h-full flex">
      <Sidebar
        profile={profile}
        projects={projects}
        activeProject={activeProject}
        setActiveProject={(p) => { setActiveProject(p); setView('board'); }}
        view={view}
        setView={setView}
        onSignOut={signOut}
        onRefresh={load}
      />
      <main className="flex-1 min-w-0 overflow-hidden">
        {view === 'users' ? (
          <UsersPanel profile={profile}/>
        ) : view === 'features' && activeProject ? (
          <FeaturesPanel project={activeProject} profile={profile}/>
        ) : activeProject ? (
          <Board project={activeProject} profile={profile} onOpenItem={setOpenItem}/>
        ) : (
          <div className="h-full flex items-center justify-center text-muted text-sm">
            No projects yet. Create one from the sidebar.
          </div>
        )}
      </main>
      {openItem && (
        <ItemDetail
          itemId={openItem}
          profile={profile}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  );
}
