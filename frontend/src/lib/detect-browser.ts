export type BrowserKind =
  | 'chromeAndroid'
  | 'chromeDesktop'
  | 'edgeDesktop'
  | 'safariIOS'
  | 'safariMacOS'
  | 'firefoxAndroid'
  | 'firefoxDesktop'
  | 'samsung'
  | 'other';

export interface BrowserInfo {
  kind: BrowserKind;
  label: string;
}

const LABELS: Record<BrowserKind, string> = {
  chromeAndroid: 'Chrome (Android)',
  chromeDesktop: 'Chrome',
  edgeDesktop: 'Microsoft Edge',
  safariIOS: 'Safari (iOS)',
  safariMacOS: 'Safari (macOS)',
  firefoxAndroid: 'Firefox (Android)',
  firefoxDesktop: 'Firefox',
  samsung: 'Samsung Internet',
  other: 'this browser',
};

export function detectBrowser(): BrowserInfo {
  if (typeof navigator === 'undefined') {
    return { kind: 'other', label: LABELS.other };
  }

  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  // iPadOS 13+ reports the desktop Safari UA but is still a touch device on Mac platform.
  const isIPadOS = platform === 'MacIntel' && maxTouchPoints > 1;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS;

  if (isIOS) {
    return { kind: 'safariIOS', label: LABELS.safariIOS };
  }

  if (/SamsungBrowser/i.test(ua)) {
    return { kind: 'samsung', label: LABELS.samsung };
  }

  // Edge identifies as "Edg/" in modern Chromium versions.
  if (/Edg\//i.test(ua)) {
    return { kind: 'edgeDesktop', label: LABELS.edgeDesktop };
  }

  if (/Firefox/i.test(ua)) {
    if (/Android/i.test(ua)) {
      return { kind: 'firefoxAndroid', label: LABELS.firefoxAndroid };
    }
    return { kind: 'firefoxDesktop', label: LABELS.firefoxDesktop };
  }

  if (/Chrome|Chromium|CriOS/i.test(ua)) {
    if (/Android/i.test(ua)) {
      return { kind: 'chromeAndroid', label: LABELS.chromeAndroid };
    }
    return { kind: 'chromeDesktop', label: LABELS.chromeDesktop };
  }

  // Desktop Safari: has "Safari" but not "Chrome" / "Chromium".
  if (/Safari/i.test(ua) && /Macintosh/i.test(ua)) {
    return { kind: 'safariMacOS', label: LABELS.safariMacOS };
  }

  return { kind: 'other', label: LABELS.other };
}
