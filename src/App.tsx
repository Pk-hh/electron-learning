import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Maximize, Volume2, VolumeX,
  Bookmark, Search, BookOpen, Home, Library, Clock, TrendingUp,
  ChevronRight, ChevronLeft, X, SlidersHorizontal, RefreshCw,
  Calculator, Atom, FlaskConical, Dna, Globe2, Languages, Cpu, Music2,
  History, PenTool, BarChart2, Microscope, Layers, GraduationCap,
  Eye, ListVideo, Star, WifiOff, AlertTriangle, Info, Sparkles,
  Share2, Zap, ChevronDown, ChevronUp, CheckCircle2,
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
  formatViewsCount,
  recordVideoView,
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
  const [libraryViewMode, setLibraryViewMode] = useState<'playlists' | 'lessons'>('playlists');

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
  const [fallbackToIframe, setFallbackToIframe] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
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

  // YouTube IFrame API PostMessage helper
  const sendYTCommand = useCallback((func: string, args: any[] = []) => {
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func, args }),
          '*'
        );
      }
    } catch {}
  }, []);

  // Speed cycler (1x -> 1.25x -> 1.5x -> 2x -> 0.75x)
  const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.75];
  const handleCycleSpeed = () => {
    const curIdx = SPEEDS.indexOf(playbackSpeed);
    const next = SPEEDS[(curIdx + 1) % SPEEDS.length];
    setPlaybackSpeed(next);
    if (activeVideo) {
      const sInfo = parseVideoSource(activeVideo.video_url);
      const isYT = sInfo.type === 'youtube' && (fallbackToIframe || !sInfo.directStreamUrl);
      if (isYT) {
        sendYTCommand('setPlaybackRate', [next]);
      }
    }
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

  // Cross-browser Fullscreen with Landscape Orientation Lock (supporting Mobile Chrome & Safari)
  const handleFullscreen = async () => {
    const el = playerContainerRef.current || videoRef.current;
    if (!el) return;
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      try {
        if (screen.orientation && (screen.orientation as any).unlock) {
          (screen.orientation as any).unlock();
        }
      } catch {}
    } else {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          await (el as any).webkitRequestFullscreen();
        } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
          (videoRef.current as any).webkitEnterFullscreen();
        }
        // Lock to landscape once in fullscreen mode (works on Android Chrome and modern mobile browsers)
        if (screen.orientation && (screen.orientation as any).lock) {
          await (screen.orientation as any).lock('landscape').catch(() => {});
        }
      } catch {
        // Safe fallback if lock is not supported or permitted on current device
      }
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

  // Handle exiting fullscreen via ESC key or browser gesture to unlock orientation
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreenNow = Boolean(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      if (!isFullscreenNow) {
        try {
          if (screen.orientation && (screen.orientation as any).unlock) {
            (screen.orientation as any).unlock();
          }
        } catch {}
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
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
    setIsPlaying(false);
    setShowControls(true);
    setIsDescExpanded(false);
    setFallbackToIframe(false);

    // Record view in database and update state dynamically
    recordVideoView(video.id, video.views).then(newCount => {
      if (newCount && newCount > (video.views || 0)) {
        setActiveVideo(prev => (prev && prev.id === video.id ? { ...prev, views: newCount } : prev));
        setVideos(prev => prev.map(v => (v.id === video.id ? { ...v, views: newCount } : v)));
      }
    });

    setTimeout(() => {
      if (videoRef.current) {
        if (resumeAt > 0) videoRef.current.currentTime = resumeAt;
        videoRef.current.play()
          .then(() => setIsPlaying(true))
          .catch(() => {
            // Autoplay rejected or waiting for user gesture
            setIsPlaying(false);
          });
      }
    }, 120);
  };

  // Listen for YouTube IFrame postMessage events to dynamically capture exact duration and state
  useEffect(() => {
    const handleYTMessage = (e: MessageEvent) => {
      try {
        let data = e.data;
        if (typeof data === 'string') {
          data = JSON.parse(data);
        }
        if (data?.event === 'infoDelivery' || data?.event === 'initialDelivery') {
          if (data?.info?.duration) {
            const ytDur = Math.round(Number(data.info.duration));
            if (ytDur > 0 && activeVideo) {
              setDuration(ytDur);
              saveDetectedDuration(activeVideo.id, ytDur);
              setActiveVideo(prev => (prev && prev.id === activeVideo.id ? { ...prev, duration: ytDur } : prev));
              setVideos(prev => prev.map(v => (v.id === activeVideo.id ? { ...v, duration: ytDur } : v)));
            }
          }
          if (data?.info?.currentTime !== undefined) {
            setCurrentTime(Math.round(data.info.currentTime));
          }
          if (data?.info?.playerState !== undefined) {
            if (data.info.playerState === 1) setIsPlaying(true);
            else if (data.info.playerState === 2 || data.info.playerState === 0) setIsPlaying(false);
          }
        }
      } catch {}
    };
    window.addEventListener('message', handleYTMessage);
    return () => window.removeEventListener('message', handleYTMessage);
  }, [activeVideo?.id]);

  // Smooth scrubber time updater while playing YouTube
  useEffect(() => {
    if (!activeVideo || !isPlaying) return;
    const sInfo = parseVideoSource(activeVideo.video_url);
    const isYT = sInfo.type === 'youtube' && (fallbackToIframe || !sInfo.directStreamUrl);
    if (isYT) {
      const interval = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + 1;
          if (duration > 0 && next >= duration) {
            setIsPlaying(false);
            return duration;
          }
          return next;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [activeVideo, isPlaying, duration, fallbackToIframe]);

  const closeVideo = () => {
    if (activeVideo && videoRef.current)
      saveLocalProgress(activeVideo.id, videoRef.current.currentTime, videoRef.current.duration || activeVideo.duration);
    setActiveVideo(null); refreshLocalData();
  };

  const handleTogglePlay = () => {
    if (iframeRef.current?.contentWindow) {
      if (isPlaying) {
        sendYTCommand('pauseVideo');
        setIsPlaying(false);
      } else {
        sendYTCommand('playVideo');
        setIsPlaying(true);
      }
    }
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
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
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const total = duration || (videoRef.current ? videoRef.current.duration : 600);
    const target = pct * total;
    if (iframeRef.current?.contentWindow) {
      sendYTCommand('seekTo', [target, true]);
      setCurrentTime(target);
      resetControlsTimeout();
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    resetControlsTimeout();
  };

  const handleSkip = (secs: number) => {
    if (iframeRef.current?.contentWindow) {
      const target = Math.max(0, Math.min(duration || 600, currentTime + secs));
      sendYTCommand('seekTo', [target, true]);
      setCurrentTime(target);
      resetControlsTimeout();
    }
    if (!videoRef.current) return;
    const maxDur = videoRef.current.duration || duration || 600;
    const target = Math.max(0, Math.min(maxDur, videoRef.current.currentTime + secs));
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    resetControlsTimeout();
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (iframeRef.current?.contentWindow) {
      sendYTCommand(nextMuted ? 'mute' : 'unMute');
    }
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
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
                      <Clock size={13} /> {formatDuration(featured.duration || 600)}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Eye size={13} /> {formatViewsCount(featured.views)}
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
                {/* View Mode Switch */}
                <div style={{ display: 'inline-flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 50, padding: 2 }}>
                  <button
                    type="button"
                    onClick={() => setLibraryViewMode('playlists')}
                    style={{
                      background: libraryViewMode === 'playlists' ? 'var(--brand)' : 'transparent',
                      color: libraryViewMode === 'playlists' ? '#fff' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: 50,
                      padding: '0.3rem 0.8rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <ListVideo size={13} /> Unit Playlists
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryViewMode('lessons')}
                    style={{
                      background: libraryViewMode === 'lessons' ? 'var(--brand)' : 'transparent',
                      color: libraryViewMode === 'lessons' ? '#fff' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: 50,
                      padding: '0.3rem 0.8rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Layers size={13} /> All Lessons
                  </button>
                </div>

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
            ) : libraryViewMode === 'playlists' ? (
              (() => {
                const unitGroups = new Map<string, Video[]>();
                const unassigned: Video[] = [];

                filteredVideos.forEach(v => {
                  const u = v.unit || v.chapter;
                  if (u) {
                    if (!unitGroups.has(u)) unitGroups.set(u, []);
                    unitGroups.get(u)!.push(v);
                  } else {
                    unassigned.push(v);
                  }
                });

                if (unitGroups.size === 0) {
                  return (
                    <div className="video-grid">
                      {filteredVideos.map(v => (
                        <VideoCard
                          key={v.id}
                          video={v}
                          onPlay={() => openVideo(v)}
                          onBookmark={() => handleToggleBookmark(v.id)}
                          isBookmarked={bookmarkIds.includes(v.id)}
                        />
                      ))}
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {Array.from(unitGroups.entries()).map(([unitName, unitVids]) => {
                      const sortedVids = [...unitVids].sort((a, b) => (a.unit_order || 1) - (b.unit_order || 1));
                      const totalDurationSec = sortedVids.reduce((acc, v) => acc + (v.duration || 600), 0);

                      return (
                        <div
                          key={unitName}
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1.5px solid var(--border)',
                            borderRadius: 16,
                            overflow: 'hidden',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
                          }}
                        >
                          <div
                            style={{
                              padding: '1.15rem 1.5rem',
                              borderBottom: '1px solid var(--border)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '1rem',
                              background: 'linear-gradient(to right, rgba(0,102,255,0.04), transparent)',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4 }}>
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 800,
                                    background: 'rgba(0,102,255,0.12)',
                                    color: 'var(--brand)',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: 6,
                                  }}
                                >
                                  Unit Playlist
                                </span>
                                <h3 style={{ margin: 0, fontWeight: 900, fontSize: '1.18rem', color: 'var(--text-primary)' }}>
                                  {unitName}
                                </h3>
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {sortedVids.length} {sortedVids.length === 1 ? 'lesson' : 'lessons'} • {formatDuration(totalDurationSec)} total watch time
                              </div>
                            </div>

                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => openVideo(sortedVids[0])}
                              style={{
                                borderRadius: 50,
                                padding: '0.55rem 1.25rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                fontWeight: 700,
                              }}
                            >
                              <Play size={14} fill="#fff" /> Play Unit Playlist
                            </button>
                          </div>

                          <div className="video-grid" style={{ padding: '1.25rem' }}>
                            {sortedVids.map(v => (
                              <VideoCard
                                key={v.id}
                                video={v}
                                onPlay={() => openVideo(v)}
                                onBookmark={() => handleToggleBookmark(v.id)}
                                isBookmarked={bookmarkIds.includes(v.id)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {unassigned.length > 0 && (
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.85rem', color: 'var(--text-secondary)' }}>
                          General Lessons ({unassigned.length})
                        </h3>
                        <div className="video-grid">
                          {unassigned.map(v => (
                            <VideoCard
                              key={v.id}
                              video={v}
                              onPlay={() => openVideo(v)}
                              onBookmark={() => handleToggleBookmark(v.id)}
                              isBookmarked={bookmarkIds.includes(v.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="video-grid">
                {filteredVideos.map(v => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    onPlay={() => openVideo(v)}
                    onBookmark={() => handleToggleBookmark(v.id)}
                    isBookmarked={bookmarkIds.includes(v.id)}
                  />
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

            {/* Top Navigation Bar of the Player Modal */}
            <div className="player-modal-nav">
              <button className="player-nav-btn" onClick={closeVideo} title="Back to lessons">
                <ChevronLeft size={18} />
                <span className="btn-label-desktop">Back</span>
              </button>

              <div className="player-nav-title-group">
                <span className="player-top-lesson-title">{activeVideo.title}</span>
                {(() => {
                  const sInfo = parseVideoSource(activeVideo.video_url);
                  if (sInfo.type === 'youtube') {
                    return (
                      <span className="player-nav-badge youtube">
                        <svg width="12" height="12" viewBox="0 0 24 24">
                          <path
                            fill="#FF0000"
                            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
                          />
                        </svg>
                        <span className="btn-label-desktop">YouTube</span>
                      </span>
                    );
                  }
                  if (sInfo.type === 'drive') {
                    return (
                      <span className="player-nav-badge drive" title="Google Drive Video">
                        <svg width="12" height="12" viewBox="0 0 87.3 78">
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
                          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                        </svg>
                        <span className="btn-label-desktop">Google Drive</span>
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>

              <div className="player-nav-actions">
                <button
                  className={`player-nav-btn bookmark-btn btn-label-desktop ${bookmarked ? 'bookmarked' : ''}`}
                  onClick={() => handleToggleBookmark(activeVideo.id)}
                  title={bookmarked ? 'Saved to bookmarks' : 'Bookmark lesson'}
                >
                  <Bookmark
                    size={16}
                    fill={bookmarked ? 'var(--brand)' : 'none'}
                    color={bookmarked ? 'var(--brand)' : 'currentColor'}
                  />
                  <span>{bookmarked ? 'Saved' : 'Save'}</span>
                </button>
                <button
                  className="player-nav-btn"
                  onClick={closeVideo}
                  title="Close player"
                  style={{ padding: '0.45rem', borderRadius: '50%' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Video Container (Our Designed Cinema Player Only!) */}
            {(() => {
              const sourceInfo = parseVideoSource(activeVideo.video_url);
              const rawTitle = (activeVideo.title || '').toLowerCase();
              const rawUrl = (activeVideo.video_url || '').toLowerCase();

              // Resolve video source (FastStart MP4 or source URL)
              let videoSrc: string | null = null;
              if (rawTitle.includes('logic') || rawUrl.includes('logic') || rawUrl.includes('qrtveulopqq')) {
                videoSrc = './videos/logic_gates.mp4';
              } else if (rawTitle.includes('diode') || rawTitle.includes('junction') || rawTitle.includes('chatrcter') || rawUrl.includes('junction') || rawUrl.includes('1j3hce2') || rawUrl.includes('1akjgei')) {
                videoSrc = './videos/pn_junction_diode.mp4';
              } else if (sourceInfo.type === 'direct') {
                videoSrc = sourceInfo.directStreamUrl || activeVideo.video_url;
              }

              // On cloud streaming links without local video, stream with our custom player UI on top
              const renderYouTubeStream = !videoSrc && (sourceInfo.type === 'youtube' || fallbackToIframe);
              const renderDriveStream = !videoSrc && sourceInfo.type === 'drive';

              return (
                <div
                  ref={playerContainerRef}
                  className={`player-video-wrapper ${showControls ? 'controls-visible' : 'controls-hidden'}`}
                  onClick={() => {
                    if (showControls) setShowControls(false);
                    else resetControlsTimeout();
                  }}
                  onMouseMove={resetControlsTimeout}
                >
                  {renderYouTubeStream ? (
                    <iframe
                      ref={iframeRef}
                      src={`https://www.youtube-nocookie.com/embed/${sourceInfo.videoId}?autoplay=1&controls=0&modestbranding=1&playsinline=1&iv_load_policy=3&enablejsapi=1&origin=${window.location.origin}`}
                      title={activeVideo.title}
                      className="player-video youtube-player-frame"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : renderDriveStream ? (
                    <iframe
                      src={sourceInfo.embedUrl}
                      title={activeVideo.title}
                      className="player-video drive-player-frame"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      src={videoSrc || activeVideo.video_url}
                      className="player-video"
                      playsInline
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onEnded={() => {
                        setIsPlaying(false);
                        saveLocalProgress(activeVideo.id, activeVideo.duration, activeVideo.duration);
                        const activeUnit = activeVideo.unit || activeVideo.chapter;
                        if (activeUnit) {
                          const unitVids = videos
                            .filter(
                              v =>
                                v.subject_id === activeVideo.subject_id &&
                                (v.unit === activeUnit || v.chapter === activeUnit)
                            )
                            .sort((a, b) => (a.unit_order || 1) - (b.unit_order || 1));
                          const currIdx = unitVids.findIndex(v => v.id === activeVideo.id);
                          if (currIdx >= 0 && currIdx < unitVids.length - 1) {
                            const nextVid = unitVids[currIdx + 1];
                            showToast(`Next in Playlist: ${nextVid.title}`);
                            setTimeout(() => openVideo(nextVid), 1200);
                          }
                        }
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      autoPlay
                      onError={() => {
                        setFallbackToIframe(true);
                      }}
                    />
                  )}

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
                          onClick={handleToggleMute}
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
                    <Eye size={13} /> {formatViewsCount(activeVideo.views)}
                  </span>
                  {activeVideo.created_at && (
                    <span className="player-meta-tag">
                      • {formatTimeAgo(activeVideo.created_at)}
                    </span>
                  )}
                  <span className="player-meta-tag">
                    <Clock size={13} /> {formatDuration(duration || activeVideo.duration || 600)}
                  </span>
                </div>
              </div>

              {/* Action Bar & Assist Cards */}
              {(() => {
                const sInfo = parseVideoSource(activeVideo.video_url);
                const isYoutube = sInfo.type === 'youtube';
                const isDrive = sInfo.type === 'drive';
                const isCompleted = (getLocalProgress(activeVideo.id)?.position ?? 0) >= (activeVideo.duration || 60);

                if (isDrive) {
                  return (
                    <div className="player-action-bar">
                      <button
                        className={`player-action-item ${bookmarked ? 'active' : ''}`}
                        onClick={() => handleToggleBookmark(activeVideo.id)}
                      >
                        <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
                        <span>{bookmarked ? 'Saved' : 'Save'}</span>
                      </button>

                      <a
                        href={`https://drive.google.com/file/d/${sInfo.videoId || ''}/view?usp=sharing`}
                        target="_blank"
                        rel="noreferrer"
                        className="player-action-item"
                        style={{ color: '#0F9D58', textDecoration: 'none' }}
                        title="Open directly in Google Drive app"
                      >
                        <svg width="18" height="18" viewBox="0 0 87.3 78" style={{ display: 'inline-block' }}>
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
                          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                        </svg>
                        <span style={{ fontWeight: 800 }}>Drive App ↗</span>
                      </a>

                      <button className="player-action-item" onClick={() => handleShare(activeVideo)}>
                        <Share2 size={18} />
                        <span>Share</span>
                      </button>

                      <button
                        className={`player-action-item ${isCompleted ? 'active' : ''}`}
                        onClick={() => {
                          saveLocalProgress(activeVideo.id, activeVideo.duration || 100, activeVideo.duration || 100);
                          refreshLocalData();
                          showToast('Marked as Completed! 🎉');
                        }}
                      >
                        <CheckCircle2 size={18} color={isCompleted ? 'var(--brand)' : 'currentColor'} />
                        <span>{isCompleted ? 'Completed' : 'Done ✓'}</span>
                      </button>
                    </div>
                  );
                }

                if (isYoutube) {
                  return (
                    <div className="player-action-bar">
                      <button
                        className={`player-action-item ${bookmarked ? 'active' : ''}`}
                        onClick={() => handleToggleBookmark(activeVideo.id)}
                      >
                        <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
                        <span>{bookmarked ? 'Saved' : 'Save'}</span>
                      </button>

                      <a
                        href={`https://www.youtube.com/watch?v=${sInfo.videoId || ''}`}
                        target="_blank"
                        rel="noreferrer"
                        className="player-action-item"
                        style={{ color: '#DC2626', textDecoration: 'none' }}
                        title="Watch directly on YouTube"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" style={{ display: 'inline-block' }}>
                          <path
                            fill="#FF0000"
                            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
                          />
                        </svg>
                        <span style={{ fontWeight: 800 }}>YouTube ↗</span>
                      </a>

                      <button className="player-action-item" onClick={() => handleShare(activeVideo)}>
                        <Share2 size={18} />
                        <span>Share</span>
                      </button>

                      <button
                        className={`player-action-item ${isCompleted ? 'active' : ''}`}
                        onClick={() => {
                          saveLocalProgress(activeVideo.id, activeVideo.duration || 100, activeVideo.duration || 100);
                          refreshLocalData();
                          showToast('Marked as Completed! 🎉');
                        }}
                      >
                        <CheckCircle2 size={18} color={isCompleted ? 'var(--brand)' : 'currentColor'} />
                        <span>{isCompleted ? 'Completed' : 'Done ✓'}</span>
                      </button>
                    </div>
                  );
                }

                return (
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
                );
              })()}

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

              {/* Up Next in Unit Playlist / Recommended Queue */}
              {(() => {
                const activeUnitName = activeVideo.unit || activeVideo.chapter;
                const unitPlaylist = activeUnitName
                  ? videos
                      .filter(
                        v =>
                          v.subject_id === activeVideo.subject_id &&
                          (v.unit === activeUnitName || v.chapter === activeUnitName)
                      )
                      .sort((a, b) => (a.unit_order || 1) - (b.unit_order || 1))
                  : [];

                const currentUnitIndex = unitPlaylist.findIndex(v => v.id === activeVideo.id);

                if (unitPlaylist.length > 0) {
                  return (
                    <div className="player-up-next-section">
                      <div
                        className="player-up-next-heading"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ListVideo size={18} color="var(--brand)" />
                          <span style={{ fontWeight: 800 }}>Playlist: {activeUnitName}</span>
                        </div>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: 'rgba(0, 102, 255, 0.12)',
                            color: 'var(--brand)',
                            padding: '0.15rem 0.5rem',
                            borderRadius: 6,
                          }}
                        >
                          Lesson {currentUnitIndex + 1} of {unitPlaylist.length}
                        </span>
                      </div>

                      <div className="up-next-cards-list">
                        {unitPlaylist.map((v, idx) => {
                          const isCurrent = v.id === activeVideo.id;
                          return (
                            <div
                              key={v.id}
                              className={`up-next-video-card ${isCurrent ? 'active-playing-lesson' : ''}`}
                              onClick={() => {
                                if (!isCurrent) openVideo(v);
                              }}
                              style={{
                                border: isCurrent ? '2px solid var(--brand)' : undefined,
                                background: isCurrent ? 'rgba(0, 102, 255, 0.06)' : undefined,
                              }}
                            >
                              <div className="up-next-card-thumb-wrap">
                                <img
                                  src={
                                    v.thumbnail_url ||
                                    'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=260'
                                  }
                                  alt={v.title}
                                  className="up-next-card-thumb"
                                />
                                <span className="up-next-badge-duration">{formatDuration(v.duration || 600)}</span>
                                <div className="up-next-play-hover">
                                  <Play size={16} fill="#fff" />
                                </div>
                              </div>
                              <div className="up-next-card-content">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span className="up-next-lesson-num">Lesson {v.unit_order || idx + 1}</span>
                                  {isCurrent && (
                                    <span
                                      style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 800,
                                        color: 'var(--brand)',
                                        textTransform: 'uppercase',
                                      }}
                                    >
                                      ▶ Now Playing
                                    </span>
                                  )}
                                </div>
                                <div className="up-next-card-title">{v.title}</div>
                                <div className="up-next-card-meta">
                                  {v.subject_name && <span className="subject-pill mini">{v.subject_name}</span>}
                                  <span>{formatViewsCount(v.views)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // Fallback: general Up Next if no unit is set
                const otherVideos = videos
                  .filter(v => v.id !== activeVideo.id && (v.subject_id === activeVideo.subject_id || !activeVideo.subject_id))
                  .concat(videos.filter(v => v.id !== activeVideo.id && v.subject_id !== activeVideo.subject_id));

                if (otherVideos.length === 0) return null;

                return (
                  <div className="player-up-next-section">
                    <div className="player-up-next-heading">
                      <ListVideo size={18} color="var(--brand)" />
                      <span>Up Next in this Course</span>
                    </div>
                    <div className="up-next-cards-list">
                      {otherVideos.map((v, idx) => (
                        <div key={v.id} className="up-next-video-card" onClick={() => openVideo(v)}>
                          <div className="up-next-card-thumb-wrap">
                            <img
                              src={
                                v.thumbnail_url ||
                                'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=260'
                              }
                              alt={v.title}
                              className="up-next-card-thumb"
                            />
                            <span className="up-next-badge-duration">{formatDuration(v.duration || 600)}</span>
                            <div className="up-next-play-hover">
                              <Play size={16} fill="#fff" />
                            </div>
                          </div>
                          <div className="up-next-card-content">
                            <span className="up-next-lesson-num">Lesson {idx + 1}</span>
                            <div className="up-next-card-title">{v.title}</div>
                            <div className="up-next-card-meta">
                              {v.subject_name && <span className="subject-pill mini">{v.subject_name}</span>}
                              <span>{formatViewsCount(v.views)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
        <img
          src={video.thumbnail_url || 'https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=400'}
          alt={video.title}
          className="video-thumb"
          loading="lazy"
          onError={e => {
            const target = e.currentTarget as HTMLImageElement;
            if (target.src.includes('maxresdefault.jpg')) {
              target.src = target.src.replace('maxresdefault.jpg', 'hqdefault.jpg');
            } else if (!target.src.includes('unsplash.com')) {
              target.src = 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400';
            }
          }}
        />
        {(() => {
          const parsed = parseVideoSource(video.video_url);
          if (parsed.type === 'youtube') {
            return (
              <span className="youtube-card-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path
                    fill="#FF0000"
                    d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
                  />
                </svg>
                <span>YouTube</span>
              </span>
            );
          }
          if (parsed.type === 'vimeo') {
            return (
              <span
                style={{
                  position: 'absolute',
                  top: 9,
                  left: 9,
                  background: 'rgba(37, 99, 235, 0.92)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 7,
                  zIndex: 2,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                Vimeo
              </span>
            );
          }
          if (parsed.type === 'drive') {
            return (
              <span
                style={{
                  position: 'absolute',
                  top: 9,
                  left: 9,
                  background: 'rgba(15, 157, 88, 0.95)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 7,
                  zIndex: 2,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 87.3 78" style={{ flexShrink: 0 }}>
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/>
                  <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                  <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
                <span>Drive</span>
              </span>
            );
          }
          return null;
        })()}
        <div className="video-play-overlay">
          <Play size={22} fill="currentColor" />
        </div>
        <span className="video-duration">
          <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />
          {formatDuration(video.duration || 600)}
        </span>
        {progressPct !== undefined && progressPct > 0 && (
          <div className="video-progress-bar"><div className="video-progress-fill" style={{ width: `${progressPct}%` }} /></div>
        )}
      </div>
      <div className="video-info">
        <div className="video-title">{video.title}</div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: '0.4rem 0', flexWrap: 'wrap' }}>
          {video.subject_name && <span className="subject-pill">{video.subject_name}</span>}
          {(video.unit || video.chapter) && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#2563eb',
                background: 'rgba(59, 130, 246, 0.08)',
                padding: '0.12rem 0.45rem',
                borderRadius: 5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <ListVideo size={10} /> {video.unit || video.chapter}
            </span>
          )}
        </div>
        {video.description && <div className="video-desc">{video.description}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem' }}>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={11} /> {formatViewsCount(video.views)}
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
