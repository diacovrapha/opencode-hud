import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  className?: string;
};

/**
 * Estado vazio: ilustração simples (emoji SVG) + texto amigável.
 */
export function EmptyState({
  icon,
  title,
  description,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <Card
      className={cn(
        "glass flex flex-col items-center justify-center gap-3 border-white/10 p-10 text-center",
        className,
      )}
    >
      <div className="rounded-full border border-white/10 bg-white/5 p-4">
        {icon ?? (
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-violet-300"
          >
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 3 5-7" />
            <circle cx="7" cy="14" r="1.2" />
            <circle cx="11" cy="10" r="1.2" />
            <circle cx="15" cy="13" r="1.2" />
            <circle cx="20" cy="6" r="1.2" />
          </svg>
        )}
      </div>
      <div>
        <div className="text-base font-medium">{title}</div>
        {description && (
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
    </Card>
  );
}

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...rest }: SkeletonProps): React.JSX.Element {
  return <div className={cn("skeleton", className)} {...rest} />;
}

/**
 * Skeleton de página (vários blocos).
 */
export function PageSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}