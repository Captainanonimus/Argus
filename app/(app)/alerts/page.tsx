import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertsTable } from "@/components/alerts/AlertsTable";
import { LoadingState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading alerts" rows={10} />}>
      <AlertsTable />
    </Suspense>
  );
}
