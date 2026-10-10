import type { Metadata } from "next";
import { IBM_Plex_Sans_Condensed } from "next/font/google";
import { AppShell } from "@/components/app/AppShell";

const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: { template: "%s | Argus", default: "Argus terminal" },
  description: "Argus market surveillance terminal",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={plexCondensed.variable}>
      <AppShell>{children}</AppShell>
    </div>
  );
}
