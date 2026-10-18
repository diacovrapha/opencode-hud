import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type CountUpProps = {
  value: number;
  duration?: number;
  /** Número de casas decimais a exibir (padrão 0). */
  digits?: number;
  className?: string;
  /** Locale para a formatação. */
  locale?: string;
};

/**
 * Animação curta de count-up ao mudar o número. Respeita
 * `prefers-reduced-motion`.
 */
export function CountUp({
  value,
  duration = 0.5,
  digits = 0,
  className,
  locale = "pt-BR",
}: CountUpProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = React.useState<number>(value);
  const previous = React.useRef<number>(value);

  React.useEffect(() => {
    const from = previous.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    if (reduceMotion) {
      setDisplay(to);
      previous.current = to;
      return;
    }
    let frame = 0;
    const start = performance.now();
    const delta = to - from;
    const durationMs = Math.max(120, duration * 1000);
    let raf = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + delta * eased;
      setDisplay(current);
      frame += 1;
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setDisplay(to);
        previous.current = to;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduceMotion]);

  const formatted = display.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return (
    <motion.span className={cn("tabular", className)}>
      {formatted}
    </motion.span>
  );
}