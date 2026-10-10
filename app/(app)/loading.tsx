import { LoadingState } from "@/components/app/ui";

export default function Loading() {
  return (
    <div className="p-3">
      <LoadingState label="Loading page" rows={8} />
    </div>
  );
}
