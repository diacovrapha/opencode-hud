import * as React from "react";
import { formatTokens, formatTokensShort } from "@/lib/ui/format";
import { cn } from "@/lib/utils";

type TokenCountProps = {
  n: number;
  className?: string;
  short?: boolean;
  tone?: "default" | "muted";
};

/**
 * Número de tokens formatado em pt-BR ("1,23 mi", "345 mil").
 */
export function TokenCount({
  n,
  className,
  short = false,
  tone = "default",
}: TokenCountProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "tabular",
        tone === "muted" ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {short ? formatTokensShort(n) : formatTokens(n)}
    </span>
  );
}