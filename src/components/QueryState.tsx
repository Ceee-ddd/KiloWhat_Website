import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/kit";

type Props<T> = {
  query: UseQueryResult<T>;
  /** Return true when the loaded data has nothing to show. */
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  /** Number of placeholder rows on the very first load. */
  rows?: number;
  children: (data: T) => ReactNode;
};

/**
 * One place for loading, empty and error states.
 * - first load: skeleton rows
 * - later refetches: the old data stays on screen, with a small "Updating" note (no blanking, no flicker)
 * - error with old data: old data stays, with a small retry strip
 * - error without data: message with Retry
 */
export function QueryState<T>({ query, isEmpty, emptyText = "Nothing to show yet.", rows = 4, children }: Props<T>) {
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center">
          <CircleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <p className="flex-1 text-sm text-ink">{query.error instanceof Error ? query.error.message : "Could not load the data."}</p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </Button>
        </Card>
      );
    }
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (isEmpty?.(query.data)) {
    return <Card className="p-6 text-center text-sm text-subtle">{emptyText}</Card>;
  }

  return (
    <>
      {query.isError && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-subtle">
          <span>Could not refresh. Showing the last loaded data.</span>
          <button type="button" className="font-semibold text-brand hover:underline" onClick={() => query.refetch()}>Retry</button>
        </div>
      )}
      {children(query.data)}
      {query.isFetching && !query.isError && <p className="mt-2 text-right text-[11px] text-subtle" aria-live="polite">Updating…</p>}
    </>
  );
}