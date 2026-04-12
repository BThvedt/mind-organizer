"use client";

import { useEffect, useRef } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineIndicator() {
  const { isOnline } = useOnlineStatus();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      navigator.serviceWorker?.controller?.postMessage({
        type: "REPLAY_MUTATIONS",
      });
    }
  }, [isOnline]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur-sm transition-all duration-300",
        isOnline
          ? "pointer-events-none translate-y-4 opacity-0"
          : "translate-y-0 opacity-100",
      )}
    >
      <WifiOff className="h-4 w-4 text-amber-500" />
      <span>You&apos;re offline &mdash; changes will sync when reconnected</span>
    </div>
  );
}
