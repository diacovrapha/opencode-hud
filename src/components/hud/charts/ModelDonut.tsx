import * as React from "react";
import type { EChartsOption } from "echarts";
import { EChart, HUD_THEME } from "./EChart";
import type { Breakdown } from "@/lib/data/types";
import { formatMoney, formatTokens, type MoneyFmt } from "@/lib/ui/format";
import { EmptyState } from "@/components/hud/EmptyState";

type ModelDonutProps = {
  data: Breakdown[];
  fmt?: MoneyFmt;
  className?: string;
};

/**
 * Donut com a distribuição do custo por modelo. Quando não há dados,
 * mostra um `EmptyState` em vez do anel cinza padrão do ECharts.
 */
export function ModelDonut({ data, fmt, className }: ModelDonutProps): React.JSX.Element {
  if (!data || data.length === 0 || data.every((b) => b.aggregate.cost === 0)) {
    return (
      <EmptyState
        title="Sem dados por modelo"
        description="Distribuição aparece assim que houver uso registrado."
        className={className}
      />
    );
  }
  const option = React.useMemo<EChartsOption>(() => {
    const top = data.slice(0, 8);
    const total = data.reduce((acc, b) => acc + b.aggregate.cost, 0);
    const items = top.map((b) => ({
      name: b.label,
      value: b.aggregate.cost,
    }));
    return {
      backgroundColor: HUD_THEME.backgroundColor,
      color: HUD_THEME.color,
      tooltip: {
        ...HUD_THEME.tooltip,
        trigger: "item",
        formatter: (params: unknown): string => {
          const p = params as { name: string; value: number; percent: number };
          const label = fmt
            ? formatMoney(p.value, fmt, { hideSecondary: true }).primary
            : `$${p.value.toFixed(4)}`;
          return `<div style="font-weight:600">${p.name}</div><div style="color:#c4b5fd">${label}</div><div style="color:rgba(226,232,240,0.6);font-size:11px;margin-top:2px">${p.percent.toFixed(1)}% do total</div>`;
        },
      },
      legend: {
        ...HUD_THEME.legend,
        orient: "vertical",
        right: 0,
        top: "middle",
        textStyle: { color: "rgba(226, 232, 240, 0.75)", fontSize: 11 },
        itemGap: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["38%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: "rgba(11, 11, 20, 0.9)",
            borderWidth: 2,
            borderRadius: 4,
          },
          label: {
            show: true,
            position: "center",
            formatter: (): string => {
              const formatted = fmt
                ? formatMoney(total, fmt, { hideSecondary: true }).primary
                : `$${total.toFixed(2)}`;
              return `{a|Total no período}\n{b|${formatted}}`;
            },
            rich: {
              a: {
                color: "rgba(226, 232, 240, 0.6)",
                fontSize: 11,
                lineHeight: 18,
                fontWeight: 500,
              },
              b: {
                color: "#e2e8f0",
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 22,
              },
            },
          },
          emphasis: {
            label: { show: true },
            scale: true,
            scaleSize: 6,
          },
          labelLine: { show: false },
          data: items,
        },
      ],
    };
  }, [data, fmt]);

  return <EChart option={option} className={className} />;
}

type TokensDonutProps = {
  data: Breakdown[];
  className?: string;
};

/**
 * Donut alternativo mostrando tokens por modelo (modo "tokens").
 */
export function TokensDonut({ data, className }: TokensDonutProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Sem tokens ainda"
        description="Tokens aparecem aqui assim que uma sessão for processada."
        className={className}
      />
    );
  }
  const option = React.useMemo<EChartsOption>(() => {
    const items = data.slice(0, 8).map((b) => ({
      name: b.label,
      value:
        b.aggregate.tokens.input +
        b.aggregate.tokens.output +
        b.aggregate.tokens.reasoning +
        b.aggregate.tokens.cacheRead +
        b.aggregate.tokens.cacheWrite,
    }));
    const total = items.reduce((a, b) => a + b.value, 0);
    return {
      backgroundColor: HUD_THEME.backgroundColor,
      color: HUD_THEME.color,
      tooltip: {
        ...HUD_THEME.tooltip,
        trigger: "item",
        formatter: (params: unknown): string => {
          const p = params as { name: string; value: number; percent: number };
          return `<div style="font-weight:600">${p.name}</div><div style="color:#c4b5fd">${formatTokens(p.value)}</div><div style="color:rgba(226,232,240,0.6);font-size:11px;margin-top:2px">${p.percent.toFixed(1)}% do total</div>`;
        },
      },
      legend: {
        ...HUD_THEME.legend,
        orient: "vertical",
        right: 0,
        top: "middle",
        textStyle: { color: "rgba(226, 232, 240, 0.75)", fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["38%", "50%"],
          itemStyle: {
            borderColor: "rgba(11, 11, 20, 0.9)",
            borderWidth: 2,
            borderRadius: 4,
          },
          label: {
            show: true,
            position: "center",
            formatter: (): string => `{a|Total}\n{b|${formatTokens(total)}}`,
            rich: {
              a: {
                color: "rgba(226, 232, 240, 0.6)",
                fontSize: 11,
                lineHeight: 18,
                fontWeight: 500,
              },
              b: {
                color: "#e2e8f0",
                fontSize: 16,
                fontWeight: 600,
                lineHeight: 22,
              },
            },
          },
          labelLine: { show: false },
          data: items,
        },
      ],
    };
  }, [data]);
  return <EChart option={option} className={className} />;
}
