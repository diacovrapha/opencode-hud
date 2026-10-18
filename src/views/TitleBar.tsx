import * as React from "react";
import { Minus, Square, X as CloseIcon, Sparkles } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TitleBarProps = {
  title?: string;
  className?: string;
};

/** "true" só quando rodando dentro do Tauri (vite dev/test = false). */
function isInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Barra de título customizada: substitui as decorações nativas.
 * - Área central é arrastável (`data-tauri-drag-region`).
 * - Botões à direita: minimizar, maximizar, fechar.
 *
 * `getCurrentWindow()` é chamado APENAS dentro dos handlers, depois do
 * `isInTauri()` retornar `true`. Chamá-lo durante o render quebra a
 * renderização fora do Tauri (vite dev/test).
 */
export function TitleBar({ title = "opencode HUD", className }: TitleBarProps): React.JSX.Element {
  async function toggleMaximize(): Promise<void> {
    if (!isInTauri()) return;
    try {
      const win = getCurrentWindow();
      const isMax = await win.isMaximized();
      await (isMax ? win.unmaximize() : win.maximize());
    } catch (e) {
      console.warn("toggleMaximize:", e);
    }
  }

  async function minimize(): Promise<void> {
    if (!isInTauri()) return;
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn("minimize:", e);
    }
  }

  async function closeWindow(): Promise<void> {
    if (!isInTauri()) return;
    try {
      await getCurrentWindow().hide();
    } catch (e) {
      console.warn("hide:", e);
    }
  }

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "titlebar flex h-10 w-full select-none items-center justify-between border-b border-white/5 bg-black/30 px-3 backdrop-blur",
        className,
      )}
    >
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center gap-2 text-sm text-foreground/90"
      >
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500 shadow"
        >
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <span data-tauri-drag-region className="font-medium tracking-tight">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          aria-label="Minimizar"
          onClick={() => void minimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          aria-label="Maximizar"
          onClick={() => void toggleMaximize()}
        >
          <Square className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:bg-red-500/20 hover:text-red-300"
          aria-label="Fechar"
          onClick={() => void closeWindow()}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}