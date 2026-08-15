'use client';

import { useEffect, useRef, type RefObject } from 'react';

interface UseInfiniteScrollOptions {
  /**
   * The scrolling container used as the observer root. For lists inside a
   * `<ScrollArea>` this is the viewport element (pass the same ref you
   * give to `<ScrollArea viewportRef={…}>`). When the ref is empty the
   * browser viewport is used instead.
   */
  rootRef?: RefObject<HTMLElement | null>;
  /** Element rendered after the last row; entering view triggers a load. */
  sentinelRef: RefObject<HTMLElement | null>;
  /** Whether the server reported further pages. */
  hasMore: boolean;
  /** True while a page request is in flight — suppresses duplicate loads. */
  loading: boolean;
  /** Loads the next page. */
  onLoadMore: () => void;
  /** How early to trigger, in px before the sentinel becomes visible. */
  rootMargin?: string;
}

/**
 * Calls `onLoadMore` when the sentinel scrolls into view.
 *
 * `onLoadMore` is read through a ref so callers can pass an inline
 * closure without tearing down and rebuilding the observer on every
 * render.
 */
export function useInfiniteScroll({
  rootRef,
  sentinelRef,
  hasMore,
  loading,
  onLoadMore,
  rootMargin = '250px',
}: UseInfiniteScrollOptions): void {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      {
        root: rootRef?.current ?? null,
        rootMargin,
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // `loading` is a dependency on purpose: after a page settles the
    // observer is rebuilt, which re-fires if the sentinel is still in
    // view (i.e. the new page didn't fill the container).
  }, [hasMore, loading, rootRef, sentinelRef, rootMargin]);
}
