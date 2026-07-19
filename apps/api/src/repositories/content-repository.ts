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

export type DuaTitleMatch = Dua & { matchScore: number };

export interface ContentRepository {
  getCurrentDataset(): Promise<DatasetSummary>;
  countDuas(): Promise<number>;
  listDuas(offset: number, limit: number): Promise<DuaSummary[]>;
  searchDuas(query: string, offset: number, limit: number): Promise<{ items: DuaSummary[]; total: number }>;
  findDuasByTitle(query: string, limit: number): Promise<DuaTitleMatch[]>;
  getRandomDua(): Promise<Dua | undefined>;
  getDua(id: string): Promise<Dua | undefined>;
}
