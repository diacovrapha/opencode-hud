import * as React from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TitleBarProps = {
  title?: string;
  className?: string;
};

/**
 * Barra de título customizada: substitui as decorações nativas.
 * Usa `data-tauri-drag-region` para que a área central seja arrastável.
 */
export function TitleBar({ title = "opencode HUD", className }: TitleBarProps): React.JSX.Element {
  const win = getCurrentWindow();

  async function toggleMaximize(): Promise<void> {
    const isMax = await win.isMaximized();
    await (isMax ? win.unmaximize() : win.maximize());
  }

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "titlebar flex h-9 w-full select-none items-center justify-between bg-background/80 px-3 backdrop-blur",
        className,
      )}
    >
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center gap-2 text-sm text-muted-foreground"
      >
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-violet-500 to-sky-500"
        />
        <span data-tauri-drag-region className="font-medium tracking-tight">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Minimizar"
          onClick={() => void win.minimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Maximizar"
          onClick={() => void toggleMaximize()}
        >
          <Square className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Fechar"
          onClick={() => void win.hide()}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}