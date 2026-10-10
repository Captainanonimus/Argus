import type { Metadata } from "next";
import { Suspense } from "react";
import { Assistant } from "@/components/assistant/Assistant";
import { LoadingState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading assistant" rows={8} />}>
      <Assistant />
    </Suspense>
  );
}
