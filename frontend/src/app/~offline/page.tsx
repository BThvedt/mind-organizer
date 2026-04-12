"use client";

import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <WifiOff className="h-16 w-16 text-muted-foreground" />
      <h1 className="text-2xl font-semibold text-foreground">
        You&apos;re offline
      </h1>
      <p className="max-w-sm text-muted-foreground">
        This page hasn&apos;t been cached yet. Connect to the internet to load
        it, or go back to a page you&apos;ve already visited.
      </p>
      <button
        type="button"
        onClick={() => history.back()}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Go back
      </button>
    </div>
  );
}
