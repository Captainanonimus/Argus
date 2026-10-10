import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { LoadingState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading dashboard" rows={10} />}>
      <Dashboard />
    </Suspense>
  );
}
