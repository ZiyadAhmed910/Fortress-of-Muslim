import type { Dua, DuaSummary } from '@fortress/contracts';

export type DatasetSummary = {
  id: string;
  sourceName: string;
  sourceVersion: string;
  publicationStatus: 'draft' | 'active' | 'deprecated';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  recordCount: number;
  contentHash: string;
  importedAt: string;
};

export interface ContentRepository {
  getCurrentDataset(): Promise<DatasetSummary>;
  countDuas(): Promise<number>;
  listDuas(offset: number, limit: number): Promise<DuaSummary[]>;
  searchDuas(query: string, offset: number, limit: number): Promise<{ items: DuaSummary[]; total: number }>;
  getRandomDua(): Promise<Dua | undefined>;
  getDua(id: string): Promise<Dua | undefined>;
}
