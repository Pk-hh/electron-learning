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
import type { Video, Subject, LessonNote } from '../types';

// ─── Local Storage Keys ──────────────────────────────────────────────────────
const BOOKMARKS_KEY = 'electrON_bookmarks';
const PROGRESS_KEY = 'electrON_progress';
const LOCAL_VIEWS_MAP_KEY = 'electrON_local_views_map';
const DURATIONS_KEY = 'electrON_video_durations';
const NOTES_KEY = 'electrON_lesson_notes';

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

// ─── Local Views Storage Map ──────────────────────────────────────────────────
export function getLocalViewsMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_VIEWS_MAP_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveLocalViewsMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(LOCAL_VIEWS_MAP_KEY, JSON.stringify(map));
  } catch {}
}

// ─── Video Views Tracking ──────────────────────────────────────────────────
// In-memory debounce map to prevent rapid double-counting on multiple clicks
const lastRecordedTimes: Record<string, number> = {};

export function hasDeviceViewedVideo(videoId: string): boolean {
  try {
    const map = getLocalViewsMap();
    return Boolean(map[videoId] && map[videoId] > 0);
  } catch {
    return false;
  }
}

export async function recordVideoView(videoId: string, currentViews: number = 0): Promise<number> {
  if (!videoId) return currentViews;
  try {
    const now = Date.now();
    const lastTime = lastRecordedTimes[videoId] || 0;
    const localMap = getLocalViewsMap();

    // Debounce: prevent duplicate increments within 10 seconds on same video session
    if (now - lastTime < 10000) {
      return Math.max(currentViews, localMap[videoId] || 0);
    }
    lastRecordedTimes[videoId] = now;

    // Calculate next view count
    const baseCount = Math.max(currentViews, localMap[videoId] || 0);
    const updatedCount = baseCount + 1;
    localMap[videoId] = updatedCount;
    saveLocalViewsMap(localMap);

    // Atomically increment views in Firestore
    try {
      await updateDoc(doc(db, 'videos', videoId), {
        views: increment(1),
      });
    } catch (fsErr) {
      console.warn('Firestore views increment note:', fsErr);
    }

    return updatedCount;
  } catch (err) {
    console.warn('recordVideoView error:', err);
    return (currentViews || 0) + 1;
  }
}

// Backwards-compatible wrapper
export async function recordDeviceView(videoId: string, currentViews: number = 0): Promise<boolean> {
  const next = await recordVideoView(videoId, currentViews);
  return next > currentViews;
}

// ─── Firestore parser ────────────────────────────────────────────────────────

export function parseScheduledDate(raw: any): string | undefined {
  if (!raw) return undefined;
  try {
    if (typeof raw?.toDate === 'function') {
      return raw.toDate().toISOString();
    }
    if (typeof raw?.seconds === 'number') {
      return new Date(raw.seconds * 1000).toISOString();
    }
    if (typeof raw === 'number') {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch {}
  return undefined;
}

export function parseCreatedDate(raw: any): string {
  if (!raw) return new Date(Date.now() - 3600000).toISOString();
  try {
    // 1. Firestore Timestamp instance
    if (raw && typeof raw.toDate === 'function') {
      return raw.toDate().toISOString();
    }
    // 2. Serialized Firestore Timestamp object { seconds, nanoseconds }
    if (raw && typeof raw.seconds === 'number') {
      return new Date(raw.seconds * 1000).toISOString();
    }
    // 3. Numeric epoch timestamp
    if (typeof raw === 'number') {
      return new Date(raw).toISOString();
    }
    // 4. ISO or date string
    if (typeof raw === 'string') {
      const p = new Date(raw);
      if (!isNaN(p.getTime())) {
        return p.toISOString();
      }
    }
  } catch {}
  return new Date().toISOString();
}

function docToVideo(d: QueryDocumentSnapshot): Video {
  const data = d.data();
  const createdStr = parseCreatedDate(data.created_at);
  const updatedStr = parseCreatedDate(data.updated_at || data.created_at);
  const scheduledStr = parseScheduledDate(data.scheduled_at);
  const isLive = Boolean(data.is_live === true || data.is_live === 'true' || data.is_live === 1 || Boolean(scheduledStr));

  const cachedDurations = getCachedDurations();
  const rawDur = typeof data.duration === 'number' ? data.duration : (parseInt(data.duration, 10) || 0);

  // If raw duration is 0 or unprobed, check cached duration.
  // For link/external videos, if not cached yet, default to 600 (10 min) so duration badge is never missing
  const isLinkOrYT = data.video_url?.startsWith('http') || (data.video_url && !data.video_url.startsWith('/videos/'));
  const finalDur = (rawDur > 0 && rawDur !== 600)
    ? rawDur
    : (cachedDurations[d.id] ?? (rawDur > 0 ? rawDur : (isLinkOrYT ? 600 : 0)));

  // Views handling: use real database views or locally synced view count
  const firestoreViews = typeof data.views === 'number' ? data.views : (parseInt(data.views, 10) || 0);
  const localMap = getLocalViewsMap();
  const localKnown = localMap[d.id] ?? 0;
  const finalViews = Math.max(firestoreViews, localKnown);

  return {
    id: d.id,
    title: data.title ?? '',
    description: data.description ?? '',
    subject_id: data.subject_id ?? '',
    subject_name: data.subject_name ?? '',
    chapter: data.chapter ?? data.unit ?? '',
    unit: data.unit ?? data.chapter ?? '',
    unit_order: typeof data.unit_order === 'number' ? data.unit_order : 0,
    duration: finalDur,
    thumbnail_url: data.thumbnail_url ?? '',
    video_url: data.video_url ?? '',
    material_url: data.material_url ?? data.materials_url ?? '',
    material_title: data.material_title ?? '',
    materials: Array.isArray(data.materials)
      ? data.materials
      : (data.material_url ? [{ title: data.material_title || 'Study Material', url: data.material_url }] : []),
    status: (data.status ?? 'published') as 'published' | 'draft',
    views: finalViews,
    is_live: isLive,
    scheduled_at: scheduledStr,
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
    color: data.color ?? '#2563EB',
    units: Array.isArray(data.units) ? data.units : [],
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

export function formatViewsCount(views: number = 0): string {
  const count = Math.max(0, Math.floor(views || 0));
  if (count === 1) return '1 view';
  if (count < 1000) return `${count} views`;
  if (count < 1000000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}K views`;
  }
  const m = (count / 1000000).toFixed(1).replace(/\.0$/, '');
  return `${m}M views`;
}

export function formatTimeAgo(dateInput?: string | number | Date | null): string {
  if (!dateInput) return 'Recently';
  let date: Date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else if (typeof dateInput === 'number') {
    date = new Date(dateInput);
  } else {
    date = new Date(dateInput);
  }
  if (isNaN(date.getTime())) return 'Recently';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
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

// ─── Video Link & Source Parser ──────────────────────────────────────────────

export interface VideoSourceInfo {
  type: 'youtube' | 'vimeo' | 'drive' | 'direct';
  embedUrl: string;
  directStreamUrl?: string;
  originalUrl: string;
  videoId?: string;
  suggestedThumbnail?: string;
  label: string;
}

export function parseVideoSource(url: string): VideoSourceInfo {
  if (!url) {
    return { type: 'direct', embedUrl: '', originalUrl: '', label: 'Direct Video' };
  }
  const cleanUrl = url.trim();

  // 1. YouTube
  const ytMatch = cleanUrl.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytMatch && ytMatch[1]) {
    const id = ytMatch[1];
    let directStream: string | undefined = undefined;
    if (id === 'QrTVeuloPQQ' || cleanUrl.includes('logic_gates.mp4')) {
      directStream = '/videos/logic_gates.mp4';
    }
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&enablejsapi=1`,
      directStreamUrl: directStream,
      originalUrl: cleanUrl,
      videoId: id,
      suggestedThumbnail: `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
      label: 'YouTube',
    };
  }

  // 2. Vimeo
  const vimeoMatch = cleanUrl.match(
    /(?:vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|)(\d+))/i
  );
  if (vimeoMatch && (vimeoMatch[3] || vimeoMatch[1])) {
    const id = vimeoMatch[3] || vimeoMatch[1];
    return {
      type: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`,
      originalUrl: cleanUrl,
      videoId: id,
      label: 'Vimeo',
    };
  }

  // 3. Google Drive (Files & Folders)
  const driveFolderMatch = cleanUrl.match(
    /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|folders\/)([a-zA-Z0-9_-]+)/i
  );
  if (driveFolderMatch && driveFolderMatch[1]) {
    const folderId = driveFolderMatch[1];
    if (folderId === '1j3hCE2dpEkKvTS8lV0J6bXAmsK9u4BTh') {
      const fileId = '1akjgeI2iL4n_yyigsVDSBHiowBoWufbM';
      return {
        type: 'drive',
        embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
        directStreamUrl: `/videos/pn_junction_diode.mp4`,
        originalUrl: cleanUrl,
        videoId: fileId,
        suggestedThumbnail: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
        label: 'Google Drive',
      };
    }
    return {
      type: 'drive',
      embedUrl: `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
      originalUrl: cleanUrl,
      videoId: folderId,
      suggestedThumbnail: `https://drive.google.com/thumbnail?id=${folderId}&sz=w800`,
      label: 'Google Drive',
    };
  }

  // File match (file/d/ID, open?id=ID, uc?id=ID, docs.google.com/file/d/ID)
  const driveFileMatch = cleanUrl.match(
    /(?:drive|docs)\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/|open\?id=|uc\?(?:.*&)?id=)([a-zA-Z0-9_-]+)/i
  );
  if (driveFileMatch && driveFileMatch[1]) {
    const fileId = driveFileMatch[1];
    let directStream: string | undefined = undefined;
    if (fileId === '1akjgeI2iL4n_yyigsVDSBHiowBoWufbM') {
      directStream = `/videos/pn_junction_diode.mp4`;
    }
    return {
      type: 'drive',
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      directStreamUrl: directStream,
      originalUrl: cleanUrl,
      videoId: fileId,
      suggestedThumbnail: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
      label: 'Google Drive',
    };
  }

  // 4. Direct / Local
  let directUrl = cleanUrl;
  if (cleanUrl.startsWith('/videos/')) {
    try {
      const decoded = decodeURIComponent(cleanUrl);
      directUrl = encodeURI(decoded);
    } catch {
      directUrl = cleanUrl;
    }
  }

  return {
    type: 'direct',
    embedUrl: directUrl,
    originalUrl: cleanUrl,
    label: cleanUrl.startsWith('/videos/') ? 'Local File' : 'Direct Link',
  };
}

// ─── Lesson Notes Management ────────────────────────────────────────────────
export function getLocalNotes(): LessonNote[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getVideoNotes(videoId: string): LessonNote[] {
  if (!videoId) return [];
  const notes = getLocalNotes();
  return notes
    .filter(n => n.videoId === videoId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function saveLocalNote(
  noteData: Omit<LessonNote, 'id' | 'createdAt'>
): LessonNote {
  const notes = getLocalNotes();
  const newNote: LessonNote = {
    ...noteData,
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    createdAt: new Date().toISOString(),
  };

  const updated = [newNote, ...notes];
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to save note to localStorage', err);
  }
  return newNote;
}

export function updateLocalNote(id: string, text: string): void {
  const notes = getLocalNotes();
  const updated = notes.map(n =>
    n.id === id ? { ...n, text: text.trim(), updatedAt: new Date().toISOString() } : n
  );
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(updated));
  } catch {}
}

export function deleteLocalNote(id: string): void {
  const notes = getLocalNotes();
  const filtered = notes.filter(n => n.id !== id);
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(filtered));
  } catch {}
}

