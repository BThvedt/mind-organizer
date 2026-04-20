import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { SerwistProvider } from "./serwist";
import { AuthProvider } from "@/hooks/useAuth";
import { OfflineIndicator } from "@/components/offline-indicator";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const APP_NAME = "Mind Organizer";
const APP_DESCRIPTION =
  "Flashcards, notes, and spaced repetition for effective studying";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s - ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  icons: {
    icon: [{ url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192x192.png", sizes: "192x192" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} dark`}>
      <body className="antialiased">
        <AuthProvider>
          <SerwistProvider
            swUrl="/serwist/sw.js"
            // Service worker + Serwist's history hooks fight Turbopack/HMR in dev (wrong routes, panics).
            disable={process.env.NODE_ENV === 'development'}
          >
            {children}
            <OfflineIndicator />
          </SerwistProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
