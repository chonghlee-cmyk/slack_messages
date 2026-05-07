export type SyncStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ArtworkSyncState {
  lastSyncedAt?: string;  // ISO string — 다음 실행의 after: 값
  status: SyncStatus;
  errorMessage?: string;
  totalMessages: number;
  totalReplies: number;
}

// data/sync-state.json 파일 형식
export interface SyncStateFile {
  [artworkName: string]: ArtworkSyncState;
}

export interface SyncJobOptions {
  artworkFilter?: string[];
  forceFullSync?: boolean;
  initialLookbackDays: number;
  dryRun?: boolean;
}
