import * as React from "react";
import type { EChartsOption } from "echarts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { EChart, HUD_THEME } from "./EChart";
import { EmptyState } from "@/components/hud/EmptyState";
import type { DailyPoint } from "@/lib/data/types";
import { formatMoney, type MoneyFmt } from "@/lib/ui/format";

type Mode = "money" | "tokens";

type AreaDailyProps = {
  data: DailyPoint[];
  mode?: Mode;
  fmt?: MoneyFmt;
  className?: string;
};

/**
 * Gráfico de área do gasto diário. Suporta alternar entre R$/USD
 * (modo "money") e tokens (modo "tokens"). Sem dados, mostra
 * `EmptyState` em vez de um gráfico vazio (que faz com que o ECharts
 * lance `Cannot read properties of undefined` em _initRangeOption).
 */
export function AreaDaily({
  data,
  mode = "money",
  fmt,
  className,
}: AreaDailyProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Sem dados no período"
        description="Use o opencode para gerar registros."
        className={className}
      />
    );
  }
  const option = React.useMemo<EChartsOption>(() => {
    const dates = data.map((d) => d.date);
    const real = data.map((d) => d.aggregate.cost);
    const equivalent = data.map((d) => d.aggregate.apiEquivalentCost);

    if (mode === "tokens") {
      const tokens = data.map((d) => {
        const t = d.aggregate.tokens;
        return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
      });
      return makeAreaOption(dates, [
        {
          name: "Tokens totais",
          data: tokens,
          color: "#8b5cf6",
          formatter: (v) => v.toLocaleString("pt-BR"),
        },
      ]);
    }

    return makeAreaOption(
      dates,
      [
        {
          name: "Custo real (USD)",
          data: real,
          color: "#10b981",
          formatter: (v) =>
            fmt
              ? formatMoney(v as number, fmt, { hideSecondary: true }).primary
              : `$${(v as number).toFixed(2)}`,
        },
        {
          name: "Custo equivalente na API (USD)",
          data: equivalent,
          color: "#3b82f6",
          formatter: (v) =>
            fmt
              ? formatMoney(v as number, fmt, { hideSecondary: true }).primary
              : `$${(v as number).toFixed(2)}`,
        },
      ],
      dates.length > 30,
    );
  }, [data, mode, fmt]);

  return <EChart option={option} className={className} />;
}

type Series = {
  name: string;
  data: number[];
  color: string;
  formatter?: (v: number) => string;
};

function makeAreaOption(
  dates: string[],
  series: Series[],
  manyDates = false,
): EChartsOption {
  return {
    backgroundColor: HUD_THEME.backgroundColor,
    color: series.map((s) => s.color),
    grid: {
      left: 50,
      right: 16,
      top: 28,
      bottom: 24,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 12, 30, 0.92)",
      borderColor: "rgba(255, 255, 255, 0.1)",
      textStyle: { color: "#e2e8f0", fontSize: 12 },
      extraCssText:
        "backdrop-filter: blur(12px) saturate(160%); -webkit-backdrop-filter: blur(12px) saturate(160%); border-radius: 8px;",
      axisPointer: {
        type: "cross",
        lineStyle: { color: "rgba(139, 92, 246, 0.4)" },
      },
      formatter: (params: unknown): string => {
        const arr = params as Array<{
          axisValue: string;
          seriesName: string;
          value: number;
          color: string;
          marker: string;
        }>;
        if (!Array.isArray(arr) || arr.length === 0) return "";
        const date = arr[0].axisValue;
        let label: string;
        try {
          label = format(parseISO(date), "dd 'de' MMM", { locale: ptBR });
        } catch {
          label = date;
        }
        const lines = arr
          .map((p) => {
            const formatter = series.find((s) => s.name === p.seriesName)?.formatter;
            const value = formatter ? formatter(p.value) : String(p.value);
            return `<div style="display:flex;justify-content:space-between;gap:12px"><span>${p.marker}${p.seriesName}</span><span style="font-variant-numeric:tabular-nums;color:#e2e8f0">${value}</span></div>`;
          })
          .join("");
        return `<div style="font-weight:600;margin-bottom:4px">${label}</div>${lines}`;
      },
    },
    legend: {
      ...HUD_THEME.legend,
      right: 0,
      top: 0,
      textStyle: { color: "rgba(226, 232, 240, 0.7)", fontSize: 11 },
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLabel: {
        color: "rgba(226, 232, 240, 0.65)",
        fontSize: 10,
        formatter: (v: string): string => {
          try {
            return format(parseISO(v), manyDates ? "dd" : "dd MMM", {
              locale: ptBR,
            });
          } catch {
            return v;
          }
        },
        interval: manyDates ? 6 : 2,
      },
      axisLine: { lineStyle: { color: "rgba(255, 255, 255, 0.08)" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "rgba(226, 232, 240, 0.65)",
        fontSize: 10,
        formatter: (v: number): string => {
          if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} mi`;
          if (v >= 1_000) return `${(v / 1_000).toFixed(1)} k`;
          return v.toFixed(0);
        },
      },
      splitLine: { lineStyle: { color: "rgba(255, 255, 255, 0.05)" } },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 4,
      showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: {
        opacity: 0.25,
      },
      emphasis: {
        focus: "series",
        areaStyle: { opacity: 0.4 },
      },
      data: s.data,
    })),
  };
}