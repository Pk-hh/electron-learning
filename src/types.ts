// Student Web App Data Models — Firebase Firestore Edition

export interface Subject {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface Video {
  id: string;
  title: string;
  description?: string;
  subject_id?: string;
  subject_name?: string;
  chapter?: string;
  video_url: string;
  thumbnail_url?: string;
  duration: number;          // seconds
  status: 'draft' | 'published' | 'archived';
  views: number;
  created_at: string;
  updated_at: string;
}

export interface WatchProgress {
  videoId: string;
  position: number;          // seconds
  duration: number;          // seconds
  watchedAt: string;
}

export interface BookmarkItem {
  videoId: string;
  bookmarkedAt: string;
}
