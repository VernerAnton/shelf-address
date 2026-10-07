import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import { AppUpdate } from "@/components/app-update";
import { VersionStamp } from "@/components/version-stamp";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shelf-Address",
  description: "Scan a book, log where it lives, walk back to it later.",
  // Installed to the home screen, it opens full-screen like an app. The
  // manifest link itself is rendered in the layout below, not here.
  appleWebApp: { capable: true, title: "Shelf", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

// §7: mobile-first is the real usage pattern, not a convenience. `maximum-scale`
// is deliberately left alone so pinch-zoom still works one-handed in the store.
// `viewportFit: cover` lets the bottom nav sit clear of the iPhone home bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

/**
 * The app opens on Evaluate (docs/spec-corrections.md §20). A phone keeps the
 * start page it was given when the app was installed (/scan before V14) and
 * may never refresh it (iPhone), so a launch that lands on /scan is sent on
 * to /evaluate here, before anything shows. Only a launch: the installed app,
 * the first page of the session, a fresh load — not a reload, not the Scan
 * tab, not a browser tab.
 */
const LAUNCH_TO_EVALUATE = `(function(){try{
var first=!sessionStorage.getItem("launched");sessionStorage.setItem("launched","1");
var app=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
var nav=performance.getEntriesByType("navigation")[0];
if(first&&app&&location.pathname==="/scan"&&!location.search&&(!nav||nav.type==="navigate"))location.replace("/evaluate");
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_TO_EVALUATE }} />
        {/*
          Written by hand rather than via Next's `manifest` metadata so it can
          carry crossOrigin="use-credentials". Browsers fetch the manifest
          without cookies by default; behind Cloudflare Access that fetch would
          get the login page instead, and installing would silently fail.
          React hoists this into <head>.
        */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]">
          {children}
          <VersionStamp />
        </div>
        <BottomNav />
        <AppUpdate />
      </body>
    </html>
  );
}
