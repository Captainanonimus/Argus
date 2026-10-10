import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = {
  title: { template: "%s | Argus", default: "Argus terminal" },
  description: "Argus market surveillance terminal",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
