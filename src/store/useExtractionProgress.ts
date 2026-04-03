/**
 * @deprecated – Use useResourceJobProgress from '@/store/useResourceJobProgress' instead.
 * This file re-exports for backward compatibility.
 */
export {
  useResourceJobProgress as useExtractionProgress,
  useResourceJobProgress,
  type ResourceJobEntry as ExtractionProgressEntry,
  type ResourceJobStatus as ExtractionResourceStatus,
} from './useResourceJobProgress';
