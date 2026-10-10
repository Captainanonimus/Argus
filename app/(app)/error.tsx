"use client";

import Link from "next/link";
import { ErrorState, buttonClass } from "@/components/app/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-3">
      <ErrorState message="This page failed to load. Try again, or go back to the dashboard." onRetry={reset} />
      <Link href="/dashboard" className={`${buttonClass("ghost", "sm")} ml-3`}>
        Go to the dashboard
      </Link>
    </div>
  );
}
