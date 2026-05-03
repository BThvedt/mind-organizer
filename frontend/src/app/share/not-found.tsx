import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShareNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-20 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        This link isn&apos;t available
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The share link is invalid, has been revoked, or has never existed.
      </p>
      <Button
        className="mt-6"
        variant="outline"
        nativeButton={false}
        render={<Link href="/" />}
      >
        Go to homepage
      </Button>
    </div>
  );
}
