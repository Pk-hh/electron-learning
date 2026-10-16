import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Maximize, Volume2, VolumeX,
  Bookmark, Search, BookOpen, Home, Library, Clock, TrendingUp,
  ChevronRight, ChevronLeft, X, SlidersHorizontal, RefreshCw,
  Calculator, Atom, FlaskConical, Dna, Globe2, Languages, Cpu, Music2,
  History, PenTool, BarChart2, Microscope, Layers, GraduationCap,
  Eye, ListVideo, Star, WifiOff, AlertTriangle, Info, Sparkles,
} from 'lucide-react';
import type { Video, Subject } from './types';
import {
  fetchSubjects,
  fetchPublishedVideos,
  getLocalBookmarks,
  toggleLocalBookmark,
  saveLocalProgress,
  getLocalProgress,
  getContinueWatching,
  formatDuration,
} from './services/videoService';

// ── Subject icon map ──────────────────────────────────────────────────────────
const SUBJECT_ICONS: Record<string, React.ReactNode> = {
  math:        <Calculator size={20} />,
  mathematics: <Calculator size={20} />,
  physics:     <Atom size={20} />,
  chemistry:   <FlaskConical size={20} />,
  biology:     <Dna size={20} />,
  science:     <Microscope size={20} />,
  geography:   <Globe2 size={20} />,
  english:     <Languages size={20} />,
  computer:    <Cpu size={20} />,
  music:       <Music2 size={20} />,
  history:     <History size={20} />,
  art:         <PenTool size={20} />,
  economics:   <BarChart2 size={20} />,
};

function getSubjectIcon(subject: Subject) {
  const key = subject.name?.toLowerCase().split(' ')[0] ?? '';
  return SUBJECT_ICONS[key] ?? <BookOpen size={20} />;
}

// ── Progress record ───────────────────────────────────────────────────────────
interface ProgressRecord {
  videoId: string;
  position: number;
  duration: number;
  watchedAt: string;
}

// ── App ───────────────────────────────────────────────────────────────────────
export function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'library' | 'bookmarks'>('home');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'title' | 'duration' | 'views'>('newest');

  const [continueWatching, setContinueWatching] = useState<ProgressRecord[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);

  // Player
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // network status
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Data ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [subs, result] = await Promise.all([
        fetchSubjects(),
        fetchPublishedVideos({ sortBy }),
      ]);
      setSubjects(subs);
      setVideos(result.videos);
    } catch {
      setError('Could not load content. Please check your connection.');
    } finally { setLoading(false); }
  }, [sortBy]);

  const refreshLocalData = useCallback(() => {
    setContinueWatching(getContinueWatching());
    setBookmarkIds(getLocalBookmarks());
  }, []);

  useEffect(() => { loadData(); refreshLocalData(); }, [loadData, refreshLocalData]);

  // ── Player ────────────────────────────────────────────────────────────────
  const openVideo = (video: Video, startSeconds = 0) => {
    const saved = getLocalProgress(video.id);
    const resumeAt = startSeconds > 0 ? startSeconds : (saved?.position ?? 0);
    setActiveVideo(video); setCurrentTime(resumeAt);
    setBookmarked(getLocalBookmarks().includes(video.id));
    setTimeout(() => {
      if (videoRef.current) {
        if (resumeAt > 0) videoRef.current.currentTime = resumeAt;
        videoRef.current.play().catch(() => {}); setIsPlaying(true);
      }
    }, 100);
  };

  const closeVideo = () => {
    if (activeVideo && videoRef.current)
      saveLocalProgress(activeVideo.id, videoRef.current.currentTime, videoRef.current.duration || activeVideo.duration);
    setActiveVideo(null); refreshLocalData();
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); }
    else { videoRef.current.play().catch(() => {}); setIsPlaying(true); }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !activeVideo) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur); setDuration(videoRef.current.duration || activeVideo.duration);
    if (Math.floor(cur) % 5 === 0)
      saveLocalProgress(activeVideo.id, cur, videoRef.current.duration || activeVideo.duration);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const target = ((e.clientX - rect.left) / rect.width) * (videoRef.current.duration || 1);
    videoRef.current.currentTime = target; setCurrentTime(target);
  };

  const handleSkip = (secs: number) => {
    if (!videoRef.current) return;
    const target = Math.max(0, Math.min(videoRef.current.duration, videoRef.current.currentTime + secs));
    videoRef.current.currentTime = target; setCurrentTime(target);
  };

  const handleToggleBookmark = (videoId: string) => {
    const isNow = toggleLocalBookmark(videoId);
    if (activeVideo?.id === videoId) setBookmarked(isNow);
    refreshLocalData();
  };

  const currentIndex = activeVideo ? videos.findIndex(v => v.id === activeVideo.id) : -1;
  const prevVideo = currentIndex > 0 ? videos[currentIndex - 1] : null;
  const nextVideo = currentIndex >= 0 && currentIndex < videos.length - 1 ? videos[currentIndex + 1] : null;

  const fmt = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const featured = videos.find(v => v.views > 500) || videos[0];
  const popularVideos = [...videos].sort((a, b) => b.views - a.views).slice(0, 6);
  const recentVideos = [...videos].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 6);
  const bookmarkedVideos = videos.filter(v => bookmarkIds.includes(v.id));
  const continueWatchingVideos = continueWatching
    .map(p => ({ progress: p, video: videos.find(v => v.id === p.videoId) }))
    .filter((x): x is { progress: ProgressRecord; video: Video } => x.video !== undefined);
  const filteredVideos = videos.filter(v => {
    // 1. Text search
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || v.title.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q);
    if (!matchesSearch) return false;

    // 2. If no subject filter is selected, show all videos
    if (!selectedSubjectId || selectedSubjectId === '') return true;

    // 3. Subject matching: Compare both ID and Name
    const targetSubj = subjects.find(s => s.id === selectedSubjectId);
    const targetName = (targetSubj?.name ?? '').toLowerCase().trim();
    const targetId = selectedSubjectId.toLowerCase().trim();

    const vidSubjId = (v.subject_id ?? '').toLowerCase().trim();
    const vidSubjName = (v.subject_name ?? '').toLowerCase().trim();

    const matchesSubject =
      (targetId && vidSubjId === targetId) ||
      (targetName && vidSubjName === targetName) ||
      (targetName && vidSubjId === targetName) ||
      (targetId && vidSubjName === targetId) ||
      (targetName && vidSubjName.includes(targetName)) ||
      (vidSubjName && targetName.includes(vidSubjName));

    return matchesSubject;
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Network banner */}
      {!online && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FCD34D', padding: '0.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#92400E', fontWeight: 600 }}>
          <WifiOff size={15} /> You're offline — showing cached content
        </div>
      )}

      {/* ── Navbar ── */}
      <nav className="navbar">
        {mobileSearchOpen ? (
          <div className="mobile-search-bar-wrap">
            <button className="icon-btn" onClick={() => setMobileSearchOpen(false)} title="Close search" style={{ padding: '0.4rem' }}>
              <ChevronLeft size={22} />
            </button>
            <div className="search-box mobile-search-box-active">
              <Search size={16} color="var(--brand)" />
              <input
                className="search-input"
                type="text"
                autoFocus
                placeholder="Search lessons, subjects..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadData()}
              />
              {searchQuery && (
                <button
                  className="icon-btn"
                  onClick={() => setSearchQuery('')}
                  style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
                  title="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
              <div className="brand-badge" onClick={() => { setActiveTab('home'); setSelectedSubjectId(null); }}>
                <img
                  src="/logo.png"
                  alt="electrONLearning Logo"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    objectFit: 'contain',
                    background: '#fff',
                    padding: 2,
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--border)',
                  }}
                />
                <div>
                  <div className="brand-title">electr<span>ON</span>Learning</div>
                  <div className="brand-tagline">Learn Anytime. Learn Anywhere.</div>
                </div>
              </div>

              <div className="nav-links">
                <button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
                  <Home size={15} /> Home
                </button>
                <button className={`nav-item ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
                  <Library size={15} /> Library
                </button>
                <button className={`nav-item ${activeTab === 'bookmarks' ? 'active' : ''}`} onClick={() => { refreshLocalData(); setActiveTab('bookmarks'); }}>
                  <Bookmark size={15} /> Saved
                  {bookmarkIds.length > 0 && (
                    <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: '50%', fontSize: '0.65rem', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                      {bookmarkIds.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div className="search-box desktop-search-box">
                <Search size={15} color="var(--text-muted)" />
                <input
                  className="search-input"
                  type="text"
                  placeholder="Search lessons, topics..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadData()}
                />
                {searchQuery && (
                  <button
                    className="icon-btn"
                    onClick={() => setSearchQuery('')}
                    style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
                    title="Clear"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                className="icon-btn mobile-search-btn"
                onClick={() => setMobileSearchOpen(true)}
                title="Search"
                aria-label="Search"
              >
                <Search size={19} />
              </button>
              <button className="icon-btn" onClick={loadData} title="Refresh" style={{ padding: '0.5rem' }}>
                <RefreshCw size={16} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
              </button>
            </div>
          </>
        )}
      </nav>

      {/* ── Main ── */}
      <main style={{ flex: 1, padding: '2rem 2.5rem', maxWidth: 1400, margin: '0 auto', width: '100%' }}>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '6rem', color: 'var(--text-muted)' }}>
            <RefreshCw size={36} style={{ animation: 'spin 1s linear infinite', color: 'var(--brand)', marginBottom: '1rem' }} />
            <p style={{ fontWeight: 600 }}>Loading content...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ textAlign: 'center', padding: '5rem' }}>
            <div style={{ display: 'inline-flex', background: '#FFF4EC', border: '2px solid var(--border)', borderRadius: 20, padding: '2.5rem', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <AlertTriangle size={44} color="var(--brand)" />
              <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{error}</p>
              <button className="btn-primary" onClick={loadData}><RefreshCw size={15} /> Try Again</button>
            </div>
          </div>
        )}

        {/* ── HOME ── */}
        {!loading && !error && activeTab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            {/* Quick Horizontal Subject Carousel */}
            {subjects.length > 0 && (
              <div className="subject-chips-bar">
                <button
                  className={`subject-chip ${!selectedSubjectId ? 'active' : ''}`}
                  onClick={() => { setSelectedSubjectId(null); setActiveTab('library'); }}
                >
                  <Sparkles size={14} />
                  <span>All Lessons</span>
                  <span className="chip-badge">{videos.length}</span>
                </button>
                {subjects.map(s => {
                  const isSelected = selectedSubjectId === s.id;
                  return (
                    <button
                      key={s.id}
                      className={`subject-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => { setSelectedSubjectId(s.id); setActiveTab('library'); }}
                    >
                      <span className="chip-icon">{getSubjectIcon(s)}</span>
                      <span>{s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Featured Hero */}
            {featured && (
              <div className="hero-card" onClick={() => openVideo(featured)}>
                <img src={featured.thumbnail_url || 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1400'} alt={featured.title} className="hero-thumb" />
                <div className="hero-overlay">
                  <div className="hero-badge"><Star size={11} /> Featured Lesson</div>
                  <h1 className="hero-title">{featured.title}</h1>
                  <p className="hero-desc">{featured.description}</p>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    <button className="btn-primary" style={{ borderRadius: 50 }}>
                      <Play size={15} fill="currentColor" /> Watch Now
                    </button>
                    <button className="btn-secondary" style={{ background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.35)', color: '#fff', backdropFilter: 'blur(8px)' }}
                      onClick={e => { e.stopPropagation(); handleToggleBookmark(featured.id); }}>
                      <Bookmark size={14} fill={bookmarkIds.includes(featured.id) ? 'currentColor' : 'none'} />
                      {bookmarkIds.includes(featured.id) ? 'Saved' : 'Save'}
                    </button>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Clock size={13} /> {formatDuration(featured.duration)}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Eye size={13} /> {featured.views.toLocaleString()} views
                    </span>
                    {featured.subject_name && <span className="subject-pill">{featured.subject_name}</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Continue Watching */}
            {continueWatchingVideos.length > 0 && (
              <section>
                <div className="section-header">
                  <h2 className="section-title"><Clock size={18} color="var(--brand)" /> Continue Watching</h2>
                </div>
                <div className="video-grid">
                  {continueWatchingVideos.map(({ progress, video }) => (
                    <VideoCard key={video.id} video={video}
                      onPlay={() => openVideo(video, progress.position)}
                      onBookmark={() => handleToggleBookmark(video.id)}
                      isBookmarked={bookmarkIds.includes(video.id)}
                      progressPct={Math.min(100, (progress.position / progress.duration) * 100)} />
                  ))}
                </div>
              </section>
            )}

            {/* Browse Subjects */}
            {subjects.length > 0 && (
              <section>
                <div className="section-header">
                  <h2 className="section-title"><Layers size={18} color="var(--brand)" /> Browse Subjects</h2>
                </div>
                <div className="subjects-grid">
                  {subjects.map(s => (
                    <div key={s.id} className="subject-card" style={{ borderColor: s.color || 'var(--brand)' }}
                      onClick={() => { setSelectedSubjectId(s.id); setActiveTab('library'); }}>
                      <div className="subject-icon" style={{ background: s.color || 'var(--brand)' }}>
                        {getSubjectIcon(s)}
                      </div>
                      <div className="subject-name">{s.name}</div>
                      <div className="subject-desc">{s.description}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Popular */}
            {popularVideos.length > 0 && (
              <section>
                <div className="section-header">
                  <h2 className="section-title"><TrendingUp size={18} color="var(--brand)" /> Popular Lessons</h2>
                  <button className="section-link" onClick={() => setActiveTab('library')}>View All <ChevronRight size={14} /></button>
                </div>
                <div className="video-grid">
                  {popularVideos.map(v => (
                    <VideoCard key={v.id} video={v} onPlay={() => openVideo(v)}
                      onBookmark={() => handleToggleBookmark(v.id)} isBookmarked={bookmarkIds.includes(v.id)} />
                  ))}
                </div>
              </section>
            )}

            {/* Recently Added */}
            {recentVideos.length > 0 && (
              <section>
                <div className="section-header">
                  <h2 className="section-title"><Clock size={18} color="var(--brand)" /> Recently Added</h2>
                </div>
                <div className="video-grid">
                  {recentVideos.map(v => (
                    <VideoCard key={v.id} video={v} onPlay={() => openVideo(v)}
                      onBookmark={() => handleToggleBookmark(v.id)} isBookmarked={bookmarkIds.includes(v.id)} />
                  ))}
                </div>
              </section>
            )}

            {videos.length === 0 && (
              <div style={{ textAlign: 'center', padding: '6rem', color: 'var(--text-muted)' }}>
                <GraduationCap size={52} style={{ marginBottom: '1rem', color: 'var(--brand)', opacity: 0.5 }} />
                <p style={{ fontWeight: 600, fontSize: '1.05rem' }}>No published videos yet</p>
                <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Check back soon for new lessons.</p>
              </div>
            )}
          </div>
        )}

        {/* ── LIBRARY ── */}
        {!loading && !error && activeTab === 'library' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="library-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 className="section-title"><ListVideo size={20} color="var(--brand)" /> Video Library</h2>
                <span className="library-count-pill">{filteredVideos.length} {filteredVideos.length === 1 ? 'lesson' : 'lessons'}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <SlidersHorizontal size={15} color="var(--text-muted)" />
                <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="newest">Newest First</option>
                  <option value="views">Most Viewed</option>
                  <option value="title">A–Z (Alphabetical)</option>
                  <option value="duration">Longest First</option>
                </select>
                {selectedSubjectId && (
                  <button className="btn-secondary" onClick={() => setSelectedSubjectId(null)} style={{ borderRadius: 50, padding: '0.35rem 0.85rem' }}>
                    <X size={13} /> Clear Filter
                  </button>
                )}
              </div>
            </div>

            {/* Horizontal Scrollable Subject Chips Bar */}
            {subjects.length > 0 && (
              <div className="subject-chips-bar">
                <button
                  className={`subject-chip ${!selectedSubjectId ? 'active' : ''}`}
                  onClick={() => setSelectedSubjectId(null)}
                >
                  <Sparkles size={14} />
                  <span>All Subjects</span>
                  <span className="chip-badge">{videos.length}</span>
                </button>
                {subjects.map(s => {
                  const isSelected = selectedSubjectId === s.id;
                  const count = videos.filter(v => {
                    const vidSubjId = (v.subject_id ?? '').toLowerCase().trim();
                    const vidSubjName = (v.subject_name ?? '').toLowerCase().trim();
                    const targetId = s.id.toLowerCase().trim();
                    const targetName = (s.name ?? '').toLowerCase().trim();
                    return (
                      (targetId && vidSubjId === targetId) ||
                      (targetName && vidSubjName === targetName) ||
                      (targetName && vidSubjId === targetName) ||
                      (targetId && vidSubjName === targetId) ||
                      (targetName && vidSubjName.includes(targetName)) ||
                      (vidSubjName && targetName.includes(vidSubjName))
                    );
                  }).length;

                  return (
                    <button
                      key={s.id}
                      className={`subject-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedSubjectId(isSelected ? null : s.id)}
                    >
                      <span className="chip-icon">{getSubjectIcon(s)}</span>
                      <span>{s.name}</span>
                      {count > 0 && <span className="chip-badge">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {filteredVideos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--text-muted)' }}>
                <Search size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <p style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>No lessons match your search</p>
                <p style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>Try choosing another subject or clearing your filter.</p>
                <button className="btn-secondary" onClick={() => { setSelectedSubjectId(null); setSearchQuery(''); }} style={{ marginTop: '1rem', borderRadius: 50 }}>
                  Reset all filters
                </button>
              </div>
            ) : (
              <div className="video-grid">
                {filteredVideos.map(v => (
                  <VideoCard key={v.id} video={v} onPlay={() => openVideo(v)}
                    onBookmark={() => handleToggleBookmark(v.id)} isBookmarked={bookmarkIds.includes(v.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── BOOKMARKS ── */}
        {!loading && !error && activeTab === 'bookmarks' && (
          <div>
            <h2 className="section-title" style={{ marginBottom: '1.5rem' }}><Bookmark size={18} color="var(--brand)" /> Saved Lessons</h2>
            {bookmarkedVideos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
                <Bookmark size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <p style={{ fontWeight: 600 }}>No saved lessons yet</p>
                <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Tap the bookmark icon on any video to save it here.</p>
              </div>
            ) : (
              <div className="video-grid">
                {bookmarkedVideos.map(v => (
                  <VideoCard key={v.id} video={v} onPlay={() => openVideo(v)}
                    onBookmark={() => handleToggleBookmark(v.id)} isBookmarked />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Video Player Modal ── */}
      {activeVideo && (
        <div className="player-modal-overlay" onClick={closeVideo}>
          <div className="player-modal" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="player-header">
              <button className="icon-btn player-back-btn" onClick={closeVideo} title="Back">
                <ChevronLeft size={22} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="player-title">{activeVideo.title}</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                  {activeVideo.subject_name && <span className="subject-pill">{activeVideo.subject_name}</span>}
                  {activeVideo.chapter && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><BookOpen size={12} /> {activeVideo.chapter}</span>}
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={12} /> {activeVideo.views.toLocaleString()} views</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                <button className="icon-btn" onClick={() => handleToggleBookmark(activeVideo.id)} title="Bookmark" style={{ padding: '0.5rem' }}>
                  <Bookmark size={18} fill={bookmarked ? 'var(--brand)' : 'none'} color={bookmarked ? 'var(--brand)' : 'currentColor'} />
                </button>
                <button className="icon-btn player-close-btn" onClick={closeVideo} title="Close" style={{ padding: '0.5rem' }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Video */}
            <video ref={videoRef} src={activeVideo.video_url} className="player-video"
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={() => setDuration(videoRef.current?.duration || activeVideo.duration)}
              onEnded={() => { setIsPlaying(false); saveLocalProgress(activeVideo.id, activeVideo.duration, activeVideo.duration); }}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} autoPlay />

            {/* Controls */}
            <div className="player-controls">
              {/* Seek bar */}
              <div className="progress-bar" onClick={handleSeek}>
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.8rem', fontWeight: 600 }}>
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>

              {/* Button row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="icon-btn" onClick={() => prevVideo && openVideo(prevVideo)} disabled={!prevVideo} title="Previous lesson">
                  <ChevronLeft size={18} />
                </button>
                <button className="icon-btn" onClick={() => handleSkip(-10)} title="Back 10s">
                  <RotateCcw size={17} />
                </button>
                <button className="icon-btn play-btn" onClick={handleTogglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <button className="icon-btn" onClick={() => handleSkip(10)} title="Forward 10s">
                  <RotateCw size={17} />
                </button>
                <button className="icon-btn" onClick={() => nextVideo && openVideo(nextVideo)} disabled={!nextVideo} title="Next lesson">
                  <ChevronRight size={18} />
                </button>

                <button className="icon-btn" onClick={() => { if (videoRef.current) { videoRef.current.muted = !isMuted; setIsMuted(!isMuted); } }} title={isMuted ? 'Unmute' : 'Mute'}>
                  {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                </button>

                <select className="filter-select" value={playbackSpeed}
                  onChange={e => { const s = Number(e.target.value); if (videoRef.current) videoRef.current.playbackRate = s; setPlaybackSpeed(s); }}
                  style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => <option key={s} value={s}>{s}×</option>)}
                </select>

                <button className="icon-btn" onClick={() => videoRef.current?.requestFullscreen?.()} title="Fullscreen">
                  <Maximize size={17} />
                </button>
              </div>
            </div>

            {/* Description */}
            {activeVideo.description && (
              <div style={{ padding: '1rem 1.4rem', borderTop: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, display: 'flex', gap: '0.5rem' }}>
                <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--brand)' }} />
                <span>{activeVideo.description}</span>
              </div>
            )}

            {/* Up Next in Player */}
            {videos.filter(v => v.id !== activeVideo.id).length > 0 && (
              <div className="player-up-next">
                <div className="player-up-next-title">
                  <ListVideo size={16} color="var(--brand)" /> Up Next Lessons
                </div>
                <div className="up-next-list">
                  {videos
                    .filter(v => v.id !== activeVideo.id && (v.subject_id === activeVideo.subject_id || !activeVideo.subject_id))
                    .concat(videos.filter(v => v.id !== activeVideo.id && v.subject_id !== activeVideo.subject_id))
                    .slice(0, 4)
                    .map(v => (
                      <div key={v.id} className="up-next-item" onClick={() => openVideo(v)}>
                        <div className="up-next-thumb-wrap">
                          <img src={v.thumbnail_url || 'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=200'} alt={v.title} className="up-next-thumb" />
                          <span className="up-next-duration">{formatDuration(v.duration)}</span>
                        </div>
                        <div className="up-next-details">
                          <div className="up-next-name">{v.title}</div>
                          <div className="up-next-meta">
                            {v.subject_name && <span className="subject-pill mini">{v.subject_name}</span>}
                            <span>{v.views.toLocaleString()} views</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── Mobile Bottom Navigation Bar (App-like mobile experience) ── */}
      <nav className="mobile-bottom-nav">
        <button
          className={`mobile-nav-item ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => { setActiveTab('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        >
          <Home size={21} />
          <span>Home</span>
        </button>

        <button
          className={`mobile-nav-item ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => { setActiveTab('library'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        >
          <Library size={21} />
          <span>Library</span>
        </button>

        <button
          className={`mobile-nav-item ${activeTab === 'bookmarks' ? 'active' : ''}`}
          onClick={() => { refreshLocalData(); setActiveTab('bookmarks'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        >
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Bookmark size={21} />
            {bookmarkIds.length > 0 && (
              <span className="mobile-nav-badge">
                {bookmarkIds.length}
              </span>
            )}
          </div>
          <span>Saved</span>
        </button>
      </nav>
    </div>
  );
}

// ── Video Card ────────────────────────────────────────────────────────────────
interface VideoCardProps {
  video: Video;
  onPlay: () => void;
  onBookmark: () => void;
  isBookmarked: boolean;
  progressPct?: number;
}

function VideoCard({ video, onPlay, onBookmark, isBookmarked, progressPct }: VideoCardProps) {
  return (
    <div className="video-card" onClick={onPlay}>
      <div className="video-thumb-wrap">
        <img src={video.thumbnail_url || 'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=400'}
          alt={video.title} className="video-thumb" loading="lazy" />
        <div className="video-play-overlay">
          <Play size={22} fill="currentColor" />
        </div>
        <span className="video-duration"><Clock size={10} style={{ display: 'inline', marginRight: 3 }} />{formatDuration(video.duration)}</span>
        {progressPct !== undefined && progressPct > 0 && (
          <div className="video-progress-bar"><div className="video-progress-fill" style={{ width: `${progressPct}%` }} /></div>
        )}
      </div>
      <div className="video-info">
        <div className="video-title">{video.title}</div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: '0.4rem 0', flexWrap: 'wrap' }}>
          {video.subject_name && <span className="subject-pill">{video.subject_name}</span>}
          {video.chapter && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}><BookOpen size={10} />{video.chapter}</span>}
        </div>
        {video.description && <div className="video-desc">{video.description}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={11} /> {video.views.toLocaleString()} views
          </span>
          <button className="icon-btn" onClick={e => { e.stopPropagation(); onBookmark(); }}
            style={{ padding: '0.3rem', color: isBookmarked ? 'var(--brand)' : undefined }}>
            <Bookmark size={14} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
