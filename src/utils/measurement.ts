import type { ResultType } from '../types/cubit';

export function defaultResultUnit(result: ResultType, count = 'No.'): string {
  if (result === 'Area' || result.startsWith('Vertical Area')) return 'm²';
  if (result === 'Volume' || result === 'Volume by Length') return 'm³';
  if (result.includes('Count') || result === 'Length by Centres') return count;
  if (result.startsWith('Length')) return 'm';
  return '';
}

export function isPolygonResult(result: ResultType): boolean {
  return result === 'Area' || result === 'Volume';
}
