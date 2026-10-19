// Student Web App Data Models — Firebase Firestore Edition

export interface Subject {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  units?: string[];
}

export interface VideoMaterial {
  id?: string;
  title: string;
  url: string;
  type?: 'pdf' | 'doc' | 'link' | 'drive' | 'github' | 'other';
}

export interface Video {
  id: string;
  title: string;
  description?: string;
  subject_id?: string;
  subject_name?: string;
  chapter?: string;
  unit?: string;
  unit_order?: number;
  video_url: string;
  thumbnail_url?: string;
  material_url?: string;
  material_title?: string;
  materials?: VideoMaterial[];
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

export interface LessonNote {
  id: string;
  videoId: string;
  videoTitle: string;
  subjectName?: string;
  timestamp: number;          // seconds into video where note was recorded
  text: string;
  createdAt: string;
  updatedAt?: string;
}
