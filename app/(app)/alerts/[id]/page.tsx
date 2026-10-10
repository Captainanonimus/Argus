import type { Metadata } from "next";
import { AlertCase } from "@/components/alerts/AlertCase";

export const metadata: Metadata = { title: "Case" };

export default function AlertCasePage({ params }: { params: { id: string } }) {
  return <AlertCase id={params.id} />;
}
