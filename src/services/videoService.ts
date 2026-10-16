import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
  increment,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Video, Subject } from '../types';

// ─── Local Storage Keys ──────────────────────────────────────────────────────
const BOOKMARKS_KEY = 'electrON_bookmarks';
const PROGRESS_KEY = 'electrON_progress';
const VIEWED_KEY = 'electrON_viewed_videos';
const DURATIONS_KEY = 'electrON_video_durations';

export function getCachedDurations(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DURATIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveDetectedDuration(videoId: string, durationSec: number): void {
  if (!videoId || !durationSec || durationSec <= 0) return;
  try {
    const map = getCachedDurations();
    map[videoId] = Math.round(durationSec);
    localStorage.setItem(DURATIONS_KEY, JSON.stringify(map));

    // Also attempt update in Firestore if possible
    updateDoc(doc(db, 'videos', videoId), {
      duration: Math.round(durationSec),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

// ─── 1 View Per Device Tracking ──────────────────────────────────────────────
export function hasDeviceViewedVideo(videoId: string): boolean {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]');
    return list.includes(videoId);
  } catch {
    return false;
  }
}

export async function recordDeviceView(videoId: string): Promise<boolean> {
  if (!videoId) return false;
  try {
    const list: string[] = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]');
    if (list.includes(videoId)) {
      // Already viewed on this device -> enforce 1 view per device
      return false;
    }

    // First time view on this device!
    list.push(videoId);
    localStorage.setItem(VIEWED_KEY, JSON.stringify(list));

    // Atomically increment views in Firestore
    try {
      await updateDoc(doc(db, 'videos', videoId), {
        views: increment(1),
      });
    } catch (fsErr) {
      console.warn('Firestore views increment warning:', fsErr);
    }

    return true;
  } catch (err) {
    console.warn('recordDeviceView error:', err);
    return false;
  }
}

// ─── Firestore parser ────────────────────────────────────────────────────────

function docToVideo(d: QueryDocumentSnapshot): Video {
  const data = d.data();
  let createdStr = new Date().toISOString();
  if (data.created_at?.toDate) {
    createdStr = data.created_at.toDate().toISOString();
  } else if (typeof data.created_at === 'string') {
    createdStr = data.created_at;
  }

  let updatedStr = new Date().toISOString();
  if (data.updated_at?.toDate) {
    updatedStr = data.updated_at.toDate().toISOString();
  } else if (typeof data.updated_at === 'string') {
    updatedStr = data.updated_at;
  }

  const cachedDurations = getCachedDurations();
  const rawDur = typeof data.duration === 'number' ? data.duration : (parseInt(data.duration, 10) || 0);
  const finalDur = (rawDur > 0 && rawDur !== 600) ? rawDur : (cachedDurations[d.id] ?? (rawDur > 0 ? rawDur : 0));

  return {
    id: d.id,
    title: data.title ?? '',
    description: data.description ?? '',
    subject_id: data.subject_id ?? '',
    subject_name: data.subject_name ?? '',
    chapter: data.chapter ?? '',
    duration: finalDur,
    thumbnail_url: data.thumbnail_url ?? '',
    video_url: data.video_url ?? '',
    status: (data.status ?? 'published') as 'published' | 'draft',
    views: typeof data.views === 'number' ? data.views : 0,
    created_at: createdStr,
    updated_at: updatedStr,
  };
}

function docToSubject(d: QueryDocumentSnapshot): Subject {
  const data = d.data();
  return {
    id: d.id,
    name: data.name ?? '',
    description: data.description ?? '',
    icon: data.icon ?? '📚',
    color: data.color ?? '#F97316',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchSubjects(): Promise<Subject[]> {
  try {
    const snap = await getDocs(collection(db, 'subjects'));
    if (!snap.empty) {
      return snap.docs.map(docToSubject);
    }
  } catch (err) {
    console.warn('Could not fetch subjects from Firestore:', err);
  }
  return [];
}

export async function fetchPublishedVideos(opts?: {
  subjectId?: string;
  searchQuery?: string;
  sortBy?: 'newest' | 'title' | 'duration' | 'views';
}): Promise<{ videos: Video[] }> {
  let allVideos: Video[] = [];

  try {
    // Query with where('status', '==', 'published') so Firebase security rules permit read for unauthenticated students
    const qPub = query(collection(db, 'videos'), where('status', '==', 'published'));
    const snap = await getDocs(qPub);
    if (!snap.empty) {
      allVideos = snap.docs.map(docToVideo);
    } else {
      // Fallback try reading collection directly if no status field was set
      const rawSnap = await getDocs(collection(db, 'videos'));
      allVideos = rawSnap.docs.map(docToVideo);
    }
  } catch (err) {
    console.warn('Firestore fetchPublishedVideos query error:', err);
    try {
      const rawSnap = await getDocs(collection(db, 'videos'));
      allVideos = rawSnap.docs.map(docToVideo);
    } catch (e2) {
      console.warn('Firestore fallback failed:', e2);
    }
  }

  // 1. Filter by status == 'published'
  let filtered = allVideos.filter(v => v.status === 'published' || !v.status);

  // 2. Filter by subjectId or subject_name if selected
  if (opts?.subjectId) {
    const target = opts.subjectId.trim().toLowerCase();
    filtered = filtered.filter(v => {
      const vidSubjId = (v.subject_id ?? '').trim().toLowerCase();
      const vidSubjName = (v.subject_name ?? '').trim().toLowerCase();
      return vidSubjId === target || vidSubjName === target;
    });
  }

  // 3. Search query filter
  if (opts?.searchQuery) {
    const q = opts.searchQuery.toLowerCase();
    filtered = filtered.filter(
      v => (v.title ?? '').toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q)
    );
  }

  // 4. Sort client-side
  const sortBy = opts?.sortBy ?? 'newest';
  if (sortBy === 'newest') {
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sortBy === 'title') {
    filtered.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  } else if (sortBy === 'duration') {
    filtered.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  } else if (sortBy === 'views') {
    filtered.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  }

  return { videos: filtered };
}

export async function fetchVideoById(id: string): Promise<Video | null> {
  try {
    const snap = await getDoc(doc(db, 'videos', id));
    if (snap.exists()) {
      return docToVideo(snap as QueryDocumentSnapshot);
    }
  } catch {
    // ignore
  }
  return null;
}

// ─── Local storage helpers ────────────────────────────────────────────────────

export function getLocalBookmarks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function toggleLocalBookmark(videoId: string): boolean {
  const bms = getLocalBookmarks();
  const idx = bms.indexOf(videoId);
  if (idx > -1) {
    bms.splice(idx, 1);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bms));
    return false;
  }
  bms.unshift(videoId);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bms));
  return true;
}

interface ProgressRecord {
  videoId: string;
  position: number;
  duration: number;
  watchedAt: string;
}

export function saveLocalProgress(videoId: string, position: number, duration: number): void {
  try {
    const all: Record<string, ProgressRecord> = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    all[videoId] = { videoId, position, duration, watchedAt: new Date().toISOString() };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function getLocalProgress(videoId: string): ProgressRecord | null {
  try {
    const all: Record<string, ProgressRecord> = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    return all[videoId] ?? null;
  } catch {
    return null;
  }
}

export function getContinueWatching(): ProgressRecord[] {
  try {
    const all: Record<string, ProgressRecord> = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
    return Object.values(all)
      .filter(p => p.position > 10 && p.position < p.duration - 10)
      .sort((a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime())
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function clearLocalHistory(): void {
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(BOOKMARKS_KEY);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  if (total <= 0) return '0:00';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTimeAgo(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}w ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear}y ago`;
}

export function probeVideoDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    if (!url) return resolve(0);
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      v.onloadedmetadata = () => {
        if (v.duration && !isNaN(v.duration) && v.duration > 0) {
          resolve(Math.round(v.duration));
        } else {
          resolve(0);
        }
      };
      v.onerror = () => resolve(0);
      setTimeout(() => resolve(0), 4000);
    } catch {
      resolve(0);
    }
  });
}
