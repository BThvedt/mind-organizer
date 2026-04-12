"use client";

import { useEffect } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";
import { WifiOff, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { isOnline } = useOnlineStatus();

  useEffect(() => {
    if (isOnline) {
      reset();
    }
  }, [isOnline, reset]);

  if (!isOnline) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <WifiOff className="h-14 w-14 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">
          Content not available offline
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page hasn&apos;t been cached yet. It will load automatically when
          you reconnect, or you can go back to a page you&apos;ve already
          visited.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => history.back()}>
            Go back
          </Button>
          <Button onClick={() => reset()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-xl font-semibold text-foreground">
        Something went wrong
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button onClick={() => reset()}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
