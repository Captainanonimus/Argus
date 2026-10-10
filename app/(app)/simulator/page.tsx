import type { Metadata } from "next";
import { Suspense } from "react";
import { Simulator } from "@/components/simulator/Simulator";
import { LoadingState } from "@/components/app/ui";

export const metadata: Metadata = { title: "Simulator" };

export default function SimulatorPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading simulator" rows={8} />}>
      <Simulator />
    </Suspense>
  );
}
