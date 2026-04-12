"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function useAuth() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.authenticated) {
          router.replace("/");
        } else {
          setAuthenticated(true);
        }
      })
      .catch(() => {
        setAuthenticated(true);
      });
  }, [router]);

  return authenticated;
}
