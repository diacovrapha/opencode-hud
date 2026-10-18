import * as React from "react";
import type { EChartsOption } from "echarts";
import { EChart, HUD_THEME } from "./EChart";
import { formatMoney, formatTokens, type MoneyFmt } from "@/lib/ui/format";
import { shortModelLabel } from "./ModelDonut";

type BarItem = {
  label: string;
  value: number;
  sublabel?: string;
};

type BarBreakdownProps = {
  items: BarItem[];
  unit?: string;
  className?: string;
  /** Se for true, formata como tokens (mi, mil). */
  asTokens?: boolean;
  /** Formata os valores como dinheiro (USD → moeda da UI). */
  fmt?: MoneyFmt;
};

/**
 * Gráfico de barras horizontais (top N). Mostra rótulo à esquerda e
 * valor à direita. Rótulos "provedor/modelo" aparecem só com o modelo
 * (o nome completo fica no tooltip).
 */
export function BarBreakdown({
  items,
  unit,
  className,
  asTokens = false,
  fmt,
}: BarBreakdownProps): React.JSX.Element {
  const option = React.useMemo<EChartsOption>(() => {
    const labels = items.map((i) => shortModelLabel(i.label));
    const fullLabels = items.map((i) => i.label);
    const values = items.map((i) => i.value);
    const max = Math.max(...values, 1);
    const fmtValue = (v: number): string =>
      asTokens
        ? formatTokens(v)
        : fmt
          ? formatMoney(v, fmt, { hideSecondary: true }).primary
          : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${unit ?? ""}`;

    return {
      backgroundColor: HUD_THEME.backgroundColor,
      tooltip: {
        ...HUD_THEME.tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown): string => {
          const arr = params as Array<{
            axisValue: string;
            value: number | string;
            name: string;
            dataIndex: number;
          }>;
          if (!Array.isArray(arr) || arr.length === 0) return "";
          const v = Number(arr[0].value);
          const name = fullLabels[arr[0].dataIndex] ?? arr[0].axisValue;
          return `<div style="font-weight:600">${name}</div><div style="color:#c4b5fd">${fmtValue(v)}</div>`;
        },
      },
      grid: {
        left: 8,
        right: 80,
        top: 4,
        bottom: 4,
        containLabel: true,
      },
      xAxis: {
        type: "value",
        max: max * 1.1,
        show: false,
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "rgba(226, 232, 240, 0.85)",
          fontSize: 11,
          formatter: (v: string): string => {
            const max = 22;
            return v.length > max ? v.slice(0, max - 1) + "…" : v;
          },
        },
      },
      series: [
        {
          type: "bar",
          data: values,
          barCategoryGap: "40%",
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: "#8b5cf6" },
                { offset: 1, color: "#3b82f6" },
              ],
            },
          },
          emphasis: {
            itemStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: "#a78bfa" },
                  { offset: 1, color: "#60a5fa" },
                ],
              },
            },
          },
          label: {
            show: true,
            position: "right",
            color: "rgba(226, 232, 240, 0.85)",
            fontSize: 11,
            fontWeight: 600,
            formatter: (p): string => fmtValue(Number((p as { value: number | string }).value)),
          },
        },
      ],
    };
  }, [items, unit, asTokens, fmt]);

  return <EChart option={option} className={className} />;
}