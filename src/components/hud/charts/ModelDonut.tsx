import * as React from "react";
import type { EChartsOption } from "echarts";
import { EChart, HUD_THEME } from "./EChart";
import type { Breakdown } from "@/lib/data/types";
import { formatMoney, formatTokens, type MoneyFmt } from "@/lib/ui/format";
import { EmptyState } from "@/components/hud/EmptyState";

/** "anthropic/claude-opus-5-5" → "claude-opus-5-5" (o provedor fica no tooltip). */
export function shortModelLabel(label: string): string {
  const i = label.indexOf("/");
  return i >= 0 ? label.slice(i + 1) : label;
}

type DonutItem = { name: string; full: string; value: number };

/**
 * Opção base do donut: legenda EMBAIXO (antes ficava à direita e por cima
 * do anel), total no centro e tooltip com o nome completo.
 */
function donutOption(
  items: DonutItem[],
  centerTitle: string,
  centerValue: string,
  formatValue: (v: number) => string,
): EChartsOption {
  const fullByName = new Map(items.map((i) => [i.name, i.full]));
  return {
    backgroundColor: HUD_THEME.backgroundColor,
    color: HUD_THEME.color,
    tooltip: {
      ...HUD_THEME.tooltip,
      trigger: "item",
      formatter: (params: unknown): string => {
        const p = params as { name: string; value: number; percent: number };
        return `<div style="font-weight:600">${fullByName.get(p.name) ?? p.name}</div><div style="color:#c4b5fd">${formatValue(p.value)}</div><div style="color:rgba(226,232,240,0.6);font-size:11px;margin-top:2px">${p.percent.toFixed(1).replace(".", ",")}% do total</div>`;
      },
    },
    legend: {
      ...HUD_THEME.legend,
      type: "scroll",
      orient: "horizontal",
      bottom: 0,
      left: "center",
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      textStyle: { color: "rgba(226, 232, 240, 0.75)", fontSize: 11 },
      pageTextStyle: { color: "rgba(226, 232, 240, 0.6)" },
    },
    series: [
      {
        type: "pie",
        radius: ["52%", "74%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "rgba(11, 11, 20, 0.9)", borderWidth: 2, borderRadius: 4 },
        label: {
          show: true,
          position: "center",
          formatter: (): string => `{a|${centerTitle}}\n{b|${centerValue}}`,
          rich: {
            a: { color: "rgba(226, 232, 240, 0.6)", fontSize: 11, lineHeight: 18, fontWeight: 500 },
            b: { color: "#e2e8f0", fontSize: 16, fontWeight: 600, lineHeight: 22 },
          },
        },
        emphasis: { label: { show: true }, scale: true, scaleSize: 6 },
        labelLine: { show: false },
        data: items.map(({ name, value }) => ({ name, value })),
      },
    ],
  };
}

type ModelDonutProps = {
  data: Breakdown[];
  fmt?: MoneyFmt;
  className?: string;
};

/** Donut com a distribuição do custo real por modelo. */
export function ModelDonut({ data, fmt, className }: ModelDonutProps): React.JSX.Element {
  const money = React.useCallback(
    (v: number) => (fmt ? formatMoney(v, fmt, { hideSecondary: true }).primary : `$${v.toFixed(2)}`),
    [fmt],
  );
  // Hooks sempre antes de qualquer return condicional (regra dos hooks).
  const option = React.useMemo<EChartsOption | null>(() => {
    const items = (data ?? [])
      .filter((b) => b.aggregate.cost > 0)
      .slice(0, 8)
      .map((b) => ({ name: shortModelLabel(b.label), full: b.label, value: b.aggregate.cost }));
    if (items.length === 0) return null;
    const total = items.reduce((acc, i) => acc + i.value, 0);
    return donutOption(items, "Total no período", money(total), money);
  }, [data, money]);

  if (!option) {
    return (
      <EmptyState
        title="Sem gasto por modelo"
        description="A distribuição aparece assim que houver custo registrado no período."
        className={className}
      />
    );
  }
  return <EChart option={option} className={className} />;
}

type TokensDonutProps = {
  data: Breakdown[];
  className?: string;
};

/** Donut alternativo mostrando tokens por modelo (modo "tokens"). */
export function TokensDonut({ data, className }: TokensDonutProps): React.JSX.Element {
  const option = React.useMemo<EChartsOption | null>(() => {
    const items = (data ?? [])
      .map((b) => {
        const t = b.aggregate.tokens;
        return {
          name: shortModelLabel(b.label),
          full: b.label,
          value: t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite,
        };
      })
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    if (items.length === 0) return null;
    const total = items.reduce((a, b) => a + b.value, 0);
    return donutOption(items, "Total", formatTokens(total), formatTokens);
  }, [data]);

  if (!option) {
    return (
      <EmptyState
        title="Sem tokens ainda"
        description="Os tokens aparecem aqui assim que uma sessão for processada."
        className={className}
      />
    );
  }
  return <EChart option={option} className={className} />;
}
