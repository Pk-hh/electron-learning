import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Maximize, Volume2, VolumeX,
  Bookmark, Search, BookOpen, Home, Library, Clock, TrendingUp,
  ChevronRight, ChevronLeft, X, SlidersHorizontal, RefreshCw,
  Calculator, Atom, FlaskConical, Dna, Globe2, Languages, Cpu, Music2,
  History, PenTool, BarChart2, Microscope, Layers, GraduationCap,
  Eye, ListVideo, WifiOff, AlertTriangle, Info, LayoutGrid,
  Share2, Zap, ChevronDown, ChevronUp, CheckCircle2, ExternalLink,
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

  // Global Keyboard Shortcuts when cinema player is active
  useEffect(() => {
    if (!activeVideo) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        closeVideo();
      } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleSkip(-10);
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleSkip(10);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVideo, isPlaying, isMuted, currentTime, duration]);

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
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid rgba(217, 119, 6, 0.25)', padding: '0.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--warning)', fontWeight: 600 }}>
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
                onChange={e => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.trim() && activeTab === 'home') {
                    setActiveTab('library');
                  }
                }}
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
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.trim() && activeTab === 'home') {
                      setActiveTab('library');
                    }
                  }}
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
          <div style={{ textAlign: 'center', padding: '5rem 1.5rem' }}>
            <div style={{ display: 'inline-flex', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-md)', padding: '2.5rem 3rem', flexDirection: 'column', alignItems: 'center', gap: '1rem', maxWidth: 440 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--error-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={28} color="var(--error)" />
              </div>
              <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>{error}</p>
              <button className="btn-primary" onClick={loadData}><RefreshCw size={15} /> Try Again</button>
            </div>
          </div>
        )}

        {/* ── HOME ── */}
        {!loading && !error && activeTab === 'home' && (
          <div key="home" className="tab-pane-content" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            {/* Welcoming Header (Clean, Authentic, Focused) */}
            <div className="home-welcome-header">
              <div className="home-welcome-content">
                <div className="home-welcome-badge">
                  <GraduationCap size={14} />
                  <span>Interactive Learning Portal</span>
                </div>
                <h1 className="home-welcome-title">Master Your Engineering Concepts</h1>
                <p className="home-welcome-sub">
                  Structured video lectures, organized unit playlists, and progress tracking designed for focused study.
                </p>
                <div className="home-welcome-stats">
                  <div className="home-stat-chip">
                    <Layers size={14} color="var(--brand)" />
                    <span><strong>{subjects.length}</strong> Disciplines</span>
                  </div>
                  <div className="home-stat-chip">
                    <ListVideo size={14} color="var(--brand)" />
                    <span><strong>{videos.length}</strong> Lessons</span>
                  </div>
                  {continueWatchingVideos.length > 0 && (
                    <div
                      className="home-stat-chip in-progress"
                      onClick={() => {
                        const first = continueWatchingVideos[0];
                        if (first) openVideo(first.video, first.progress.position);
                      }}
                      title="Continue watching where you left off"
                    >
                      <Clock size={14} color="var(--success)" />
                      <span>Resume: <strong>{continueWatchingVideos[0].video.title.slice(0, 26)}...</strong></span>
                      <ChevronRight size={13} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Subject Filter Bar */}
            {subjects.length > 0 && (
              <div className="subject-chips-bar">
                <button
                  className={`subject-chip ${!selectedSubjectId ? 'active' : ''}`}
                  onClick={() => { setSelectedSubjectId(null); setActiveTab('library'); }}
                >
                  <LayoutGrid size={15} />
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
                  <button className="section-link" onClick={() => { setSelectedSubjectId(null); setActiveTab('library'); }}>
                    All Lessons <ChevronRight size={14} />
                  </button>
                </div>
                <div className="subjects-grid">
                  {subjects.map(s => {
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
                      <div
                        key={s.id}
                        className="subject-card"
                        onClick={() => { setSelectedSubjectId(s.id); setActiveTab('library'); }}
                      >
                        <div className="subject-card-top">
                          <div className="subject-icon" style={{ background: s.color || 'var(--brand)' }}>
                            {getSubjectIcon(s)}
                          </div>
                          <span className="subject-card-count">{count} {count === 1 ? 'lesson' : 'lessons'}</span>
                        </div>
                        <div className="subject-name">{s.name}</div>
                        {s.description && <div className="subject-desc">{s.description}</div>}
                        <div className="subject-card-footer">
                          <span>Explore lectures</span>
                          <ChevronRight size={13} />
                        </div>
                      </div>
                    );
                  })}
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
          <div key="library" className="tab-pane-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="library-header-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 className="section-title"><ListVideo size={20} color="var(--brand)" /> Video Library</h2>
                <span className="library-count-pill">{filteredVideos.length} {filteredVideos.length === 1 ? 'lesson' : 'lessons'}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {/* View Mode Switch */}
                <div style={{ display: 'inline-flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 50, padding: 3, gap: 2 }}>
                  <button
                    type="button"
                    onClick={() => setLibraryViewMode('playlists')}
                    style={{
                      background: libraryViewMode === 'playlists' ? 'var(--brand)' : 'transparent',
                      color: libraryViewMode === 'playlists' ? '#fff' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: 50,
                      padding: '0.35rem 0.85rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: libraryViewMode === 'playlists' ? '0 1px 4px rgba(37,99,235,0.25)' : 'none',
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
                      padding: '0.35rem 0.85rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: libraryViewMode === 'lessons' ? '0 1px 4px rgba(37,99,235,0.25)' : 'none',
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
                  <LayoutGrid size={15} />
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
              <div key={libraryViewMode} className="tab-subview-content">
                {libraryViewMode === 'playlists' ? (
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
                                  background: 'linear-gradient(to right, rgba(37,99,235,0.06), transparent)',
                                }}
                              >
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 4 }}>
                                    <span
                                      style={{
                                        fontSize: '0.72rem',
                                        fontWeight: 800,
                                        background: 'var(--brand-light)',
                                        color: 'var(--brand)',
                                        border: '1px solid rgba(37, 99, 235, 0.18)',
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
          </div>
        )}

        {/* ── BOOKMARKS ── */}
        {!loading && !error && activeTab === 'bookmarks' && (
          <div key="bookmarks" className="tab-pane-content">
            <h2 className="section-title" style={{ marginBottom: '1.5rem' }}><Bookmark size={18} color="var(--brand)" /> Saved Lessons</h2>
            {bookmarkedVideos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '5rem 1rem', color: 'var(--text-muted)' }}>
                <Bookmark size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <p style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)' }}>No saved lessons yet</p>
                <p style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>Tap the bookmark icon on any video to save it here for fast revision.</p>
                <button
                  className="btn-primary"
                  onClick={() => setActiveTab('library')}
                  style={{ marginTop: '1.25rem', borderRadius: 50 }}
                >
                  <BookOpen size={15} /> Explore Lessons
                </button>
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
                    return <span className="player-nav-badge youtube">YouTube</span>;
                  }
                  if (sInfo.type === 'drive') {
                    return <span className="player-nav-badge drive">Google Drive</span>;
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

              {/* Action Bar */}
              {(() => {
                const sInfo = parseVideoSource(activeVideo.video_url);
                const isYoutube = sInfo.type === 'youtube';
                const isDrive = sInfo.type === 'drive';
                const isCompleted = (getLocalProgress(activeVideo.id)?.position ?? 0) >= (activeVideo.duration || 60);

                return (
                  <div className="player-action-bar">
                    <button
                      className={`player-action-item ${bookmarked ? 'active' : ''}`}
                      onClick={() => handleToggleBookmark(activeVideo.id)}
                      title={bookmarked ? 'Saved to bookmarks' : 'Save lesson'}
                    >
                      <Bookmark size={17} fill={bookmarked ? 'currentColor' : 'none'} />
                      <span>{bookmarked ? 'Saved' : 'Save'}</span>
                    </button>

                    <button
                      className={`player-action-item ${isCompleted ? 'active' : ''}`}
                      onClick={() => {
                        const targetPos = isCompleted ? 0 : (activeVideo.duration || 100);
                        saveLocalProgress(activeVideo.id, targetPos, activeVideo.duration || 100);
                        refreshLocalData();
                        showToast(isCompleted ? 'Marked as uncompleted' : 'Marked as completed');
                      }}
                      title="Toggle completion status"
                    >
                      <CheckCircle2 size={17} color={isCompleted ? 'var(--brand)' : 'currentColor'} />
                      <span>{isCompleted ? 'Completed' : 'Complete'}</span>
                    </button>

                    <button className="player-action-item" onClick={() => handleShare(activeVideo)} title="Share lesson link">
                      <Share2 size={17} />
                      <span>Share</span>
                    </button>

                    <button className="player-action-item" onClick={handleCycleSpeed} title="Playback speed">
                      <Zap size={17} />
                      <span>{playbackSpeed}× Speed</span>
                    </button>

                    {isYoutube && sInfo.videoId && (
                      <a
                        href={`https://www.youtube.com/watch?v=${sInfo.videoId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="player-action-item"
                        title="Watch on YouTube"
                        style={{ textDecoration: 'none' }}
                      >
                        <ExternalLink size={17} />
                        <span>YouTube</span>
                      </a>
                    )}

                    {isDrive && sInfo.videoId && (
                      <a
                        href={`https://drive.google.com/file/d/${sInfo.videoId}/view?usp=sharing`}
                        target="_blank"
                        rel="noreferrer"
                        className="player-action-item"
                        title="Open in Google Drive"
                        style={{ textDecoration: 'none' }}
                      >
                        <ExternalLink size={17} />
                        <span>Drive</span>
                      </a>
                    )}
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
                            background: 'var(--brand-light)',
                            color: 'var(--brand)',
                            border: '1px solid rgba(37, 99, 235, 0.18)',
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
                                background: isCurrent ? 'var(--brand-light)' : undefined,
                              }}
                            >
                              <div className="up-next-card-thumb-wrap">
                                <VideoThumbnail video={v} className="up-next-card-thumb" />
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
                            <VideoThumbnail video={v} className="up-next-card-thumb" />
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

// ── Video Thumbnail ───────────────────────────────────────────────────────────
interface VideoThumbnailProps {
  video: Video;
  className?: string;
}

function VideoThumbnail({ video, className = 'video-thumb' }: VideoThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const rawUrl = video.thumbnail_url?.trim();
  const isInvalidUnsplash = rawUrl?.includes('unsplash.com') && (rawUrl.includes('photo-1635070041078') || rawUrl.includes('photo-1509228627152'));
  const validUrl = isInvalidUnsplash ? null : rawUrl;

  const [imgSrc, setImgSrc] = useState<string | null>(validUrl || null);

  useEffect(() => {
    const raw = video.thumbnail_url?.trim();
    const badUnsplash = raw?.includes('unsplash.com') && (raw.includes('photo-1635070041078') || raw.includes('photo-1509228627152'));
    setImgSrc(badUnsplash ? null : (raw || null));
    setImgError(false);
  }, [video.thumbnail_url]);

  if (!imgSrc || imgError) {
    const subjName = video.subject_name || 'electrON Lecture';
    return (
      <div
        className={`${className} fallback-thumb`}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          padding: '0.85rem',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 50% 25%, rgba(37, 99, 235, 0.25) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'rgba(37, 99, 235, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#60A5FA',
            marginBottom: '0.35rem',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <BookOpen size={18} />
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#93C5FD',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {subjName}
        </span>
        <span
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#F8FAFC',
            lineHeight: 1.25,
            marginTop: 2,
            maxWidth: '92%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {video.title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={video.title}
      className={className}
      loading="lazy"
      onError={() => {
        if (imgSrc.includes('maxresdefault.jpg')) {
          setImgSrc(imgSrc.replace('maxresdefault.jpg', 'hqdefault.jpg'));
        } else {
          setImgError(true);
        }
      }}
    />
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
  const parsed = parseVideoSource(video.video_url);

  return (
    <div className="video-card" onClick={onPlay}>
      <div className="video-thumb-wrap">
        <VideoThumbnail video={video} className="video-thumb" />

        {parsed.type === 'youtube' && (
          <span className="youtube-card-badge">
            <Play size={10} fill="#EF4444" color="#EF4444" />
            <span>YouTube</span>
          </span>
        )}
        {parsed.type === 'drive' && (
          <span className="youtube-card-badge">
            <BookOpen size={11} color="#10B981" />
            <span>Drive</span>
          </span>
        )}

        <div className="video-play-overlay">
          <Play size={20} fill="currentColor" />
        </div>
        <span className="video-duration">
          {formatDuration(video.duration || 600)}
        </span>
        {progressPct !== undefined && progressPct > 0 && (
          <div className="video-progress-bar">
            <div className="video-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      <div className="video-info">
        <div className="video-title">{video.title}</div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: '0.4rem 0', flexWrap: 'wrap' }}>
          {video.subject_name && <span className="subject-pill">{video.subject_name}</span>}
          {(video.unit || video.chapter) && (
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                padding: '0.15rem 0.5rem',
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ListVideo size={11} color="var(--brand)" /> {video.unit || video.chapter}
            </span>
          )}
        </div>
        {video.description && <div className="video-desc">{video.description}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Eye size={12} /> {formatViewsCount(video.views)}
            {video.created_at && <span>• {formatTimeAgo(video.created_at)}</span>}
          </span>
          <button
            className="icon-btn"
            onClick={e => { e.stopPropagation(); onBookmark(); }}
            style={{ padding: '0.35rem', color: isBookmarked ? 'var(--brand)' : undefined }}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark lesson'}
          >
            <Bookmark size={15} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
