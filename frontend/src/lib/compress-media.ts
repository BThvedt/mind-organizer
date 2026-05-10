/**
 * Browser-side image resize/compression using the Canvas API.
 *
 * - JPEG and PNG inputs are downscaled (if larger than the limits) and
 *   re-encoded as JPEG at a fixed quality.
 * - WebP is preserved as WebP.
 * - GIF and SVG pass through untouched (animated GIFs would lose animation
 *   if rendered through canvas; SVG is already tiny).
 * - Audio and unknown types pass through.
 *
 * Returns a (possibly new) `File` plus byte-size diagnostics.
 */

const MAX_WIDTH = 720;
const MAX_HEIGHT = 1200;
const JPEG_QUALITY = 0.82;
const COMPRESS_TIMEOUT_MS = 10_000;

/** Resolve `p`, but reject with `Error('compress timeout')` after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`compress timeout: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export interface CompressionResult {
  file: File;
  originalSize: number;
  newSize: number;
  /** True if the file was actually re-encoded vs passed through unchanged. */
  resized: boolean;
}

/**
 * Compress an image (best-effort). Always resolves; falls back to the
 * original file if anything goes wrong (e.g. corrupt input, OOM).
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;
  const mime = file.type.toLowerCase();

  if (mime === 'image/gif' || mime === 'image/svg+xml') {
    return { file, originalSize, newSize: originalSize, resized: false };
  }

  if (!mime.startsWith('image/')) {
    return { file, originalSize, newSize: originalSize, resized: false };
  }

  try {
    // createImageBitmap and toBlob *can* hang on certain inputs (very
    // large images, weird color profiles, GPU contention). Without a
    // timeout, the whole upload pipeline waits forever and the
    // `pending-N` placeholder stays in the body. Time-bound both stages
    // and pass the original file through on timeout.
    const bitmap = await withTimeout(
      createImageBitmap(file),
      COMPRESS_TIMEOUT_MS,
      'createImageBitmap'
    );

    // Compute target dimensions, preserving aspect ratio. Only ever shrink.
    const scale = Math.min(
      1,
      MAX_WIDTH / bitmap.width,
      MAX_HEIGHT / bitmap.height
    );
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return { file, originalSize, newSize: originalSize, resized: false };
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const outMime = mime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await withTimeout(
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outMime, JPEG_QUALITY)
      ),
      COMPRESS_TIMEOUT_MS,
      'canvas.toBlob'
    );
    if (!blob) {
      return { file, originalSize, newSize: originalSize, resized: false };
    }

    // Don't bother swapping if compression actually made it bigger.
    if (blob.size >= originalSize && scale === 1) {
      return { file, originalSize, newSize: originalSize, resized: false };
    }

    const newName = swapExtension(file.name, outMime);
    const newFile = new File([blob], newName, {
      type: outMime,
      lastModified: file.lastModified,
    });
    return {
      file: newFile,
      originalSize,
      newSize: blob.size,
      resized: true,
    };
  } catch (err) {
    console.warn('[compressImage] falling back to original file:', file.name, err);
    return { file, originalSize, newSize: originalSize, resized: false };
  }
}

function swapExtension(name: string, mime: string): string {
  const ext =
    mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'bin';
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  return `${base}.${ext}`;
}

/**
 * Returns 'image' | 'audio' | null based on a File's MIME type.
 */
export function classifyFile(file: File): 'image' | 'audio' | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}
