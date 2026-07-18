import type { ContentSegment, Dua, DuaSummary } from '@fortress/contracts';
import source from '../../../../pwa-website/data/duas.json';

type LegacyEntry = {
  uid: string;
  sequence: number;
  title: string;
  parts: ContentSegment[][];
};

const entries = (source.entries as LegacyEntry[])
  .map(toDua)
  .sort((left, right) => left.sequence - right.sequence);

export function countDuas(): number {
  return entries.length;
}

export function listDuas(offset: number, limit: number): DuaSummary[] {
  return entries.slice(offset, offset + limit).map(({ parts: _parts, ...summary }) => summary);
}

export function getDua(id: string): Dua | undefined {
  return entries.find((entry) => entry.id === id || entry.legacyId === id);
}

function toDua(entry: LegacyEntry): Dua {
  return {
    id: `dua.hisn.${String(entry.sequence).padStart(3, '0')}`,
    legacyId: entry.uid,
    sequence: entry.sequence,
    title: entry.title,
    partCount: entry.parts.length,
    verificationStatus: 'pending',
    parts: entry.parts,
  };
}
