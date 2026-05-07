export interface ArtworkRaw {
  name: string;
  sheetRowIndex: number;
}

export interface Artwork {
  id: string;
  name: string;
  normalizedName: string;
  isActive: boolean;
  sheetRowIndex?: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
