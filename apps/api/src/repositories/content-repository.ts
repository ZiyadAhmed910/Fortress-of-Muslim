import type { CollectionSummary, Dua, DuaSummary, Hadith, HadithSummary } from '@fortress/contracts';

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

export type RecordEvidence = {
  recordId: string;
  dataset: DatasetSummary;
  collection: { id: string; title: string; verificationStatus: string } | null;
  sources: Array<{
    id: string;
    title: string;
    publisher: string | null;
    edition: string | null;
    sourceUrl: string | null;
    licenseName: string | null;
    licenseStatus: string;
    authenticityStatus: string;
    referenceType: string;
    locator: string;
    verificationStatus: string;
  }>;
  datasetSources: Array<{
    id: string;
    title: string;
    importLocator: string;
    licenseStatus: string;
    authenticityStatus: string;
  }>;
  taxonomy: Array<{ type: string; slug: string; label: string; languageCode: string }>;
  verificationHistory: Array<{ status: string; method: string; notes: string | null; reviewedAt: string }>;
  corrections: Array<{ fieldPath: string; reason: string; createdAt: string }>;
};

export interface ContentRepository {
  getCurrentDataset(): Promise<DatasetSummary>;
  listCollections(contentType?: 'dua' | 'hadith'): Promise<CollectionSummary[]>;
  countDuas(): Promise<number>;
  listDuas(offset: number, limit: number): Promise<DuaSummary[]>;
  searchDuas(query: string, offset: number, limit: number): Promise<{ items: DuaSummary[]; total: number }>;
  findDuasByTitle(query: string, limit: number): Promise<DuaTitleMatch[]>;
  getRandomDua(): Promise<Dua | undefined>;
  getDua(id: string): Promise<Dua | undefined>;
  getDuaEvidence(id: string): Promise<RecordEvidence | undefined>;
  countHadith(collection?: string): Promise<number>;
  listHadith(collection: string | undefined, offset: number, limit: number): Promise<HadithSummary[]>;
  searchHadith(query: string, collection: string | undefined, offset: number, limit: number): Promise<{ items: HadithSummary[]; total: number }>;
  getHadith(id: string): Promise<Hadith | undefined>;
}
