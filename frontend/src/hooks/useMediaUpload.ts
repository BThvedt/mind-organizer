'use client';

import { useCallback, useState } from 'react';
import { compressImage, classifyFile } from '@/lib/compress-media';

const UPLOAD_TIMEOUT_MS = 60_000;

export interface UploadedMedia {
  uuid: string;
  mediaType: 'image' | 'audio' | 'file';
  mimeType: string;
  originalFilename: string;
  fileSize: number;
  /** Always of the form `/api/media/<uuid>`. */
  url: string;
}

export interface UploadError {
  message: string;
  status?: number;
}

export interface UseMediaUploadResult {
  upload: (file: File) => Promise<UploadedMedia>;
  uploading: boolean;
}

/**
 * Compress (images only) and POST a file to /api/media/upload.
 *
 * Throws an `Error` (with `cause` populated for unexpected failures) if
 * the upload fails — callers should wrap in try/catch and surface the
 * message to the user.
 */
export function useMediaUpload(): UseMediaUploadResult {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(async (file: File): Promise<UploadedMedia> => {
    if (classifyFile(file) === null) {
      throw new Error(`Unsupported file type: ${file.type || 'unknown'}`);
    }

    setUploading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      let prepared: File = file;
      if (classifyFile(file) === 'image') {
        const result = await compressImage(file);
        prepared = result.file;
      }

      const formData = new FormData();
      formData.append('file', prepared);

      let res: Response;
      try {
        res = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } catch (err) {
        // Distinguish a timeout abort from a network failure so the user
        // gets a meaningful message either way.
        if (controller.signal.aborted) {
          throw new Error(
            `Upload timed out after ${Math.round(UPLOAD_TIMEOUT_MS / 1000)}s. Please try again.`
          );
        }
        throw new Error(
          err instanceof Error
            ? `Network error while uploading: ${err.message}`
            : 'Network error while uploading. Please try again.'
        );
      }

      if (!res.ok) {
        let message = `Upload failed (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') message = data.error;
        } catch {
          // non-JSON body; keep default
        }
        const err: UploadError = { message, status: res.status };
        throw Object.assign(new Error(err.message), { uploadError: err });
      }

      const body = (await res.json()) as UploadedMedia;
      return body;
    } finally {
      clearTimeout(timer);
      setUploading(false);
    }
  }, []);

  return { upload, uploading };
}
