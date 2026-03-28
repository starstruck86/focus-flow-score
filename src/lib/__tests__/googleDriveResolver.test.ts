import { describe, it, expect } from 'vitest';
import {
  isGoogleDriveFileUrl,
  extractDriveFileId,
  buildDirectDownloadUrl,
  buildViewerUrl,
  resolveGoogleDriveUrl,
} from '@/lib/googleDriveResolver';

describe('googleDriveResolver', () => {
  describe('isGoogleDriveFileUrl', () => {
    it('detects drive.google.com/file/d/ URLs', () => {
      expect(isGoogleDriveFileUrl('https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRs/view')).toBe(true);
    });

    it('detects drive.google.com/open?id= URLs', () => {
      expect(isGoogleDriveFileUrl('https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRs')).toBe(true);
    });

    it('detects docs.google.com/uc?id= URLs', () => {
      expect(isGoogleDriveFileUrl('https://docs.google.com/uc?id=1aBcDeFgHiJkLmNoPqRs')).toBe(true);
    });

    it('detects drive.google.com/uc?id= URLs', () => {
      expect(isGoogleDriveFileUrl('https://drive.google.com/uc?id=1aBcDeFgHiJkLmNoPqRs&export=download')).toBe(true);
    });

    it('rejects Google Docs URLs', () => {
      expect(isGoogleDriveFileUrl('https://docs.google.com/document/d/1abc/edit')).toBe(false);
    });

    it('rejects Google Sheets URLs', () => {
      expect(isGoogleDriveFileUrl('https://docs.google.com/spreadsheets/d/1abc/edit')).toBe(false);
    });

    it('rejects Google Slides URLs', () => {
      expect(isGoogleDriveFileUrl('https://docs.google.com/presentation/d/1abc/edit')).toBe(false);
    });

    it('rejects non-Drive URLs', () => {
      expect(isGoogleDriveFileUrl('https://example.com/file.pdf')).toBe(false);
    });

    it('handles empty string', () => {
      expect(isGoogleDriveFileUrl('')).toBe(false);
    });
  });

  describe('extractDriveFileId', () => {
    it('extracts from /file/d/ID/view', () => {
      expect(extractDriveFileId('https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRs/view')).toBe('1aBcDeFgHiJkLmNoPqRs');
    });

    it('extracts from /file/d/ID/view?usp=sharing', () => {
      expect(extractDriveFileId('https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRs/view?usp=sharing')).toBe('1aBcDeFgHiJkLmNoPqRs');
    });

    it('extracts from /open?id=ID', () => {
      expect(extractDriveFileId('https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRs')).toBe('1aBcDeFgHiJkLmNoPqRs');
    });

    it('extracts from /uc?id=ID&export=download', () => {
      expect(extractDriveFileId('https://drive.google.com/uc?id=1aBcDeFgHiJkLmNoPqRs&export=download')).toBe('1aBcDeFgHiJkLmNoPqRs');
    });

    it('returns null for non-Drive URLs', () => {
      expect(extractDriveFileId('https://example.com')).toBeNull();
    });

    it('handles file IDs with dashes and underscores', () => {
      expect(extractDriveFileId('https://drive.google.com/file/d/1a-B_c2D/view')).toBe('1a-B_c2D');
    });
  });

  describe('buildDirectDownloadUrl', () => {
    it('generates correct direct download URL', () => {
      expect(buildDirectDownloadUrl('1aBcDeFg')).toBe('https://drive.google.com/uc?export=download&id=1aBcDeFg');
    });
  });

  describe('buildViewerUrl', () => {
    it('generates correct viewer URL', () => {
      expect(buildViewerUrl('1aBcDeFg')).toBe('https://drive.google.com/file/d/1aBcDeFg/view');
    });
  });

  describe('resolveGoogleDriveUrl', () => {
    it('resolves a standard viewer URL', () => {
      const result = resolveGoogleDriveUrl('https://drive.google.com/file/d/1aBcDeFgHiJk/view');
      expect(result.canResolve).toBe(true);
      if (result.canResolve) {
        expect(result.fileId).toBe('1aBcDeFgHiJk');
        expect(result.directDownloadUrl).toBe('https://drive.google.com/uc?export=download&id=1aBcDeFgHiJk');
        expect(result.normalizedViewerUrl).toBe('https://drive.google.com/file/d/1aBcDeFgHiJk/view');
      }
    });

    it('fails for non-Drive URL', () => {
      const result = resolveGoogleDriveUrl('https://example.com');
      expect(result.canResolve).toBe(false);
      if (!result.canResolve) {
        expect(result.failureReason).toBe('Not a Google Drive file URL');
      }
    });

    it('fails for empty URL', () => {
      const result = resolveGoogleDriveUrl('');
      expect(result.canResolve).toBe(false);
    });
  });
});
