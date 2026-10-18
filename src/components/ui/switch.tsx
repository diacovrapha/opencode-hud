import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * Switch próprio — explicitamente colorido para o tema escuro.
 *
 * O shadcn padrão usa `bg-primary` / `bg-input` / `bg-background`. Estas
 * utilidades não existem neste projeto (o `src/index.css` declara as CSS
 * vars `--primary` / `--input` / `--background`, mas não tem um bloco
 * `@theme` mapeando-as para o Tailwind v4), o que deixa o componente
 * 100% transparente. Aqui usamos valores literais para garantir o trilho
 * sempre visível: branco translúcido quando desligado e gradiente
 * violeta→azul quando ligado.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-white/20 bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b14] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#8b5cf6] data-[state=checked]:to-[#3b82f6]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };