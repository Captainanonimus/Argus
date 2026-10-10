"use client";

import Link from "next/link";
import { ErrorState, PageHeader, buttonClass } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <PageHeader title="This page failed to load" />
      <ErrorState message="Something went wrong while loading this page. Try again, or go back to the dashboard." onRetry={reset} />
      <Link href="/dashboard" className={buttonClass("ghost", "sm")}>
        Go to the dashboard
      </Link>
    </div>
  );
}
