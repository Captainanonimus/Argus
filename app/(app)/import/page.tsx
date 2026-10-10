import type { Metadata } from "next";
import { Importer } from "@/components/import/Importer";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage() {
  return <Importer />;
}
