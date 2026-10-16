import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Maximize, Volume2, VolumeX,
  Bookmark, Search, BookOpen, Home, Library, Clock, TrendingUp,
  ChevronRight, ChevronLeft, X, SlidersHorizontal, RefreshCw,
  Calculator, Atom, FlaskConical, Dna, Globe2, Languages, Cpu, Music2,
  History, PenTool, BarChart2, Microscope, Layers, GraduationCap,
  Eye, ListVideo, Star, WifiOff, AlertTriangle, Info, Sparkles,
  Share2, Zap, ChevronDown, ChevronUp,
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
  formatTimeAgo,
  recordDeviceView,
  saveDetectedDuration,
  probeVideoDuration,
  parseVideoSource,
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

  // Player state
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<any>(null);

  // Auto-hide overlay controls after 3.5 seconds of playback
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      resetControlsTimeout();
    } else {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, resetControlsTimeout]);

  // Toast message helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  // Speed cycler (1x -> 1.25x -> 1.5x -> 2x -> 0.75x)
  const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.75];
  const handleCycleSpeed = () => {
    const curIdx = SPEEDS.indexOf(playbackSpeed);
    const next = SPEEDS[(curIdx + 1) % SPEEDS.length];
    setPlaybackSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
    showToast(`${next}× Speed`);
    resetControlsTimeout();
  };

  // Native mobile share sheet or copy link
  const handleShare = async (video: Video) => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: video.title,
          text: `Watch "${video.title}" on electrONLearning`,
          url: url,
        });
      } catch {
        // Dismissed share sheet
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard!');
      } catch {
        showToast('Lesson ready to share');
      }
    }
  };

  // Cross-browser Fullscreen (supporting iOS Safari & Android Chrome)
  const handleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) {
      v.requestFullscreen().catch(() => {});
    } else if ((v as any).webkitEnterFullscreen) {
      (v as any).webkitEnterFullscreen();
    } else if ((v as any).webkitRequestFullscreen) {
      (v as any).webkitRequestFullscreen();
    }
  };

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

      // Probe any videos with unknown or default 600s duration in background
      result.videos.forEach(v => {
        if ((!v.duration || v.duration === 600) && v.video_url) {
          probeVideoDuration(v.video_url).then(dur => {
            if (dur > 0) {
              saveDetectedDuration(v.id, dur);
              setVideos(prev => prev.map(item => item.id === v.id ? { ...item, duration: dur } : item));
            }
          });
        }
      });
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
    setActiveVideo(video);
    setCurrentTime(resumeAt);
    setDuration(video.duration || 0);
    setBookmarked(getLocalBookmarks().includes(video.id));
    setIsPlaying(true);
    setShowControls(true);
    setIsDescExpanded(false);

    // Enforce 1 view per device
    recordDeviceView(video.id).then(isNewView => {
      if (isNewView) {
        // First view from this device -> increment count in state immediately!
        setActiveVideo(prev => prev && prev.id === video.id ? { ...prev, views: (prev.views || 0) + 1 } : prev);
        setVideos(prev => prev.map(v => v.id === video.id ? { ...v, views: (v.views || 0) + 1 } : v));
      }
    });

    setTimeout(() => {
      if (videoRef.current) {
        if (resumeAt > 0) videoRef.current.currentTime = resumeAt;
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
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

  const handleLoadedMetadata = () => {
    if (!videoRef.current || !activeVideo) return;
    const realDur = Math.round(videoRef.current.duration);
    if (realDur && !isNaN(realDur) && realDur > 0) {
      setDuration(realDur);
      saveDetectedDuration(activeVideo.id, realDur);
      setActiveVideo(prev => prev ? { ...prev, duration: realDur } : null);
      setVideos(prev => prev.map(v => v.id === activeVideo.id ? { ...v, duration: realDur } : v));
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current || !activeVideo) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);
    const curDur = videoRef.current.duration || activeVideo.duration;
    if (curDur > 0 && Math.abs(curDur - duration) > 1) {
      setDuration(Math.round(curDur));
    }
    if (Math.floor(cur) % 5 === 0)
      saveLocalProgress(activeVideo.id, cur, curDur);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const target = ((e.clientX - rect.left) / rect.width) * (videoRef.current.duration || 1);
    videoRef.current.currentTime = target; setCurrentTime(target);
    resetControlsTimeout();
  };

  const handleSkip = (secs: number) => {
    if (!videoRef.current) return;
    const target = Math.max(0, Math.min(videoRef.current.duration, videoRef.current.currentTime + secs));
    videoRef.current.currentTime = target; setCurrentTime(target);
    resetControlsTimeout();
  };

  const handleToggleBookmark = (videoId: string) => {
    const isNow = toggleLocalBookmark(videoId);
    if (activeVideo?.id === videoId) setBookmarked(isNow);
    refreshLocalData();
    showToast(isNow ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
  };

  const fmt = (sec: number) => {
    return formatDuration(sec);
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
                      <Eye size={13} /> {featured.views.toLocaleString()} {featured.views === 1 ? 'view' : 'views'}
                      {featured.created_at && <span>• {formatTimeAgo(featured.created_at)}</span>}
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

      {/* ── Video Player Modal / Page (Cinema & Touch-Optimized) ── */}
      {activeVideo && (
        <div className="player-modal-overlay" onClick={closeVideo}>
          <div className="player-modal" onClick={e => e.stopPropagation()}>

            {/* Video Container (Sticky 16:9 Cinema Player) */}
            {(() => {
              const sourceInfo = parseVideoSource(activeVideo.video_url);
              const isEmbed = sourceInfo.type !== 'direct';

              if (isEmbed) {
                return (
                  <div
                    className="player-video-wrapper controls-visible"
                    style={{ position: 'relative', overflow: 'hidden' }}
                  >
                    <iframe
                      src={sourceInfo.embedUrl}
                      title={activeVideo.title}
                      className="player-video"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        background: '#000',
                      }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />

                    {/* Top Controls Overlay for Embed (Back, Title, Bookmark) */}
                    <div
                      className="player-overlay-top"
                      style={{
                        opacity: 1,
                        pointerEvents: 'auto',
                        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button className="player-overlay-btn" onClick={closeVideo} title="Back">
                        <ChevronLeft size={22} />
                      </button>
                      <div className="player-overlay-title">{activeVideo.title}</div>
                      <button
                        className="player-overlay-btn"
                        onClick={() => handleToggleBookmark(activeVideo.id)}
                        title="Save lesson"
                      >
                        <Bookmark
                          size={18}
                          fill={bookmarked ? 'var(--brand)' : 'none'}
                          color={bookmarked ? 'var(--brand)' : '#fff'}
                        />
                      </button>
                    </div>

                    {/* Toast message overlay on player */}
                    {toastMessage && (
                      <div className="player-toast">
                        {toastMessage}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div
                  className={`player-video-wrapper ${showControls ? 'controls-visible' : 'controls-hidden'}`}
                  onClick={() => {
                    if (showControls) setShowControls(false);
                    else resetControlsTimeout();
                  }}
                  onMouseMove={resetControlsTimeout}
                >
                  <video
                    ref={videoRef}
                    src={activeVideo.video_url}
                    className="player-video"
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => {
                      setIsPlaying(false);
                      saveLocalProgress(activeVideo.id, activeVideo.duration, activeVideo.duration);
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    autoPlay
                  />

                  {/* Toast message overlay on player */}
                  {toastMessage && (
                    <div className="player-toast">
                      {toastMessage}
                    </div>
                  )}

                  {/* Top Controls Overlay */}
                  <div className="player-overlay-top" onClick={e => e.stopPropagation()}>
                    <button className="player-overlay-btn" onClick={closeVideo} title="Back">
                      <ChevronLeft size={22} />
                    </button>
                    <div className="player-overlay-title">{activeVideo.title}</div>
                    <button
                      className="player-overlay-btn"
                      onClick={() => handleToggleBookmark(activeVideo.id)}
                      title="Save lesson"
                    >
                      <Bookmark
                        size={18}
                        fill={bookmarked ? 'var(--brand)' : 'none'}
                        color={bookmarked ? 'var(--brand)' : '#fff'}
                      />
                    </button>
                  </div>

                  {/* Center Controls Overlay (10s Rewind, Big Play/Pause, 10s Forward) */}
                  <div className="player-overlay-center" onClick={e => e.stopPropagation()}>
                    <button
                      className="player-overlay-btn center-skip-btn"
                      onClick={() => {
                        handleSkip(-10);
                        resetControlsTimeout();
                      }}
                      title="Rewind 10s"
                    >
                      <RotateCcw size={22} />
                      <span className="skip-sec-text">10s</span>
                    </button>

                    <button
                      className="player-main-play-btn"
                      onClick={() => {
                        handleTogglePlay();
                        resetControlsTimeout();
                      }}
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? (
                        <Pause size={28} fill="currentColor" />
                      ) : (
                        <Play size={28} fill="currentColor" style={{ marginLeft: 3 }} />
                      )}
                    </button>

                    <button
                      className="player-overlay-btn center-skip-btn"
                      onClick={() => {
                        handleSkip(10);
                        resetControlsTimeout();
                      }}
                      title="Forward 10s"
                    >
                      <RotateCw size={22} />
                      <span className="skip-sec-text">10s</span>
                    </button>
                  </div>

                  {/* Bottom Controls Overlay */}
                  <div className="player-overlay-bottom" onClick={e => e.stopPropagation()}>
                    {/* Touch Scrubber Seek Bar */}
                    <div className="player-scrubber-wrap" onClick={handleSeek}>
                      <div className="player-scrubber-track">
                        <div className="player-scrubber-fill" style={{ width: `${progressPct}%` }}>
                          <div className="player-scrubber-thumb" />
                        </div>
                      </div>
                    </div>

                    <div className="player-bottom-row">
                      <div className="player-time-text">
                        <span>{fmt(currentTime)}</span>
                        <span style={{ opacity: 0.6, margin: '0 4px' }}>/</span>
                        <span style={{ opacity: 0.8 }}>{fmt(duration)}</span>
                      </div>

                      <div className="player-bottom-actions">
                        <button
                          className="player-overlay-icon-btn"
                          onClick={() => {
                            if (videoRef.current) {
                              videoRef.current.muted = !isMuted;
                              setIsMuted(!isMuted);
                            }
                          }}
                          title={isMuted ? 'Unmute' : 'Mute'}
                        >
                          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>

                        <button
                          className="player-speed-badge-btn"
                          onClick={handleCycleSpeed}
                          title="Playback Speed"
                        >
                          {playbackSpeed}×
                        </button>

                        <button
                          className="player-overlay-icon-btn"
                          onClick={handleFullscreen}
                          title="Fullscreen"
                        >
                          <Maximize size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Lesson Details & Up Next Queue */}
            <div className="player-scroll-content">
              {/* Lesson Title & Main Metadata */}
              <div className="player-info-section">
                <h1 className="player-detail-title">{activeVideo.title}</h1>
                <div className="player-detail-meta">
                  {activeVideo.subject_name && (
                    <span className="subject-pill highlight">{activeVideo.subject_name}</span>
                  )}
                  {activeVideo.chapter && (
                    <span className="player-meta-tag">
                      <BookOpen size={13} color="var(--brand)" /> {activeVideo.chapter}
                    </span>
                  )}
                  <span className="player-meta-tag">
                    <Eye size={13} /> {activeVideo.views.toLocaleString()} {activeVideo.views === 1 ? 'view' : 'views'}
                  </span>
                  {activeVideo.created_at && (
                    <span className="player-meta-tag">
                      • {formatTimeAgo(activeVideo.created_at)}
                    </span>
                  )}
                  <span className="player-meta-tag">
                    <Clock size={13} /> {formatDuration(duration || activeVideo.duration)}
                  </span>
                </div>
              </div>

              {/* Action Bar (Bookmark, Speed, Share, Fullscreen) */}
              <div className="player-action-bar">
                <button
                  className={`player-action-item ${bookmarked ? 'active' : ''}`}
                  onClick={() => handleToggleBookmark(activeVideo.id)}
                >
                  <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
                  <span>{bookmarked ? 'Saved' : 'Save'}</span>
                </button>

                <button className="player-action-item" onClick={handleCycleSpeed}>
                  <Zap size={18} color="var(--brand)" />
                  <span>{playbackSpeed}× Speed</span>
                </button>

                <button className="player-action-item" onClick={() => handleShare(activeVideo)}>
                  <Share2 size={18} />
                  <span>Share</span>
                </button>

                <button className="player-action-item" onClick={handleFullscreen}>
                  <Maximize size={18} />
                  <span>Fullscreen</span>
                </button>
              </div>

              {/* Lesson Description (Collapsible Card) */}
              {activeVideo.description && (
                <div className="player-desc-card" onClick={() => setIsDescExpanded(!isDescExpanded)}>
                  <div className="player-desc-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.88rem' }}>
                      <Info size={15} color="var(--brand)" /> About this Lesson
                    </div>
                    {isDescExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                  <div className={`player-desc-body ${isDescExpanded ? 'expanded' : 'collapsed'}`}>
                    {activeVideo.description}
                  </div>
                </div>
              )}

              {/* Up Next in Subject / Recommended Queue */}
              {videos.filter(v => v.id !== activeVideo.id).length > 0 && (
                <div className="player-up-next-section">
                  <div className="player-up-next-heading">
                    <ListVideo size={18} color="var(--brand)" />
                    <span>Up Next in this Course</span>
                  </div>
                  <div className="up-next-cards-list">
                    {videos
                      .filter(v => v.id !== activeVideo.id && (v.subject_id === activeVideo.subject_id || !activeVideo.subject_id))
                      .concat(videos.filter(v => v.id !== activeVideo.id && v.subject_id !== activeVideo.subject_id))
                      .map((v, idx) => (
                        <div key={v.id} className="up-next-video-card" onClick={() => openVideo(v)}>
                          <div className="up-next-card-thumb-wrap">
                            <img
                              src={v.thumbnail_url || 'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=260'}
                              alt={v.title}
                              className="up-next-card-thumb"
                            />
                            <span className="up-next-badge-duration">{formatDuration(v.duration)}</span>
                            <div className="up-next-play-hover">
                              <Play size={16} fill="#fff" />
                            </div>
                          </div>
                          <div className="up-next-card-content">
                            <span className="up-next-lesson-num">Lesson {idx + 1}</span>
                            <div className="up-next-card-title">{v.title}</div>
                            <div className="up-next-card-meta">
                              {v.subject_name && <span className="subject-pill mini">{v.subject_name}</span>}
                              <span>{v.views.toLocaleString()} {v.views === 1 ? 'view' : 'views'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
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
        {(() => {
          const parsed = parseVideoSource(video.video_url);
          if (parsed.type === 'youtube') {
            return (
              <span
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'rgba(220, 38, 38, 0.92)',
                  color: '#fff',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  padding: '2px 6px',
                  borderRadius: 4,
                  letterSpacing: '0.5px',
                  zIndex: 2,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                YOUTUBE
              </span>
            );
          }
          if (parsed.type === 'vimeo') {
            return (
              <span
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'rgba(37, 99, 235, 0.92)',
                  color: '#fff',
                  fontSize: '0.62rem',
                  fontWeight: 900,
                  padding: '2px 6px',
                  borderRadius: 4,
                  letterSpacing: '0.5px',
                  zIndex: 2,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                VIMEO
              </span>
            );
          }
          return null;
        })()}
        <div className="video-play-overlay">
          <Play size={22} fill="currentColor" />
        </div>
        {video.duration > 0 && (
          <span className="video-duration">
            <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />
            {formatDuration(video.duration)}
          </span>
        )}
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
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={11} /> {video.views.toLocaleString()} {video.views === 1 ? 'view' : 'views'}
            {video.created_at && <span>• {formatTimeAgo(video.created_at)}</span>}
          </span>
          <button className="icon-btn" onClick={e => { e.stopPropagation(); onBookmark(); }}
            style={{ padding: '0.35rem', color: isBookmarked ? 'var(--brand)' : undefined }}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark lesson'}>
            <Bookmark size={15} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
