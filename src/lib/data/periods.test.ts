import { describe, expect, it } from "vitest";
import {
  dayKey,
  daysInMonth,
  elapsedMonthDays,
  fractionOfDayElapsed,
  listDailyDays,
  periodStart,
  periodStartMs,
  startOfLocalDay,
  todayStart,
} from "@/lib/data/periods";

describe("periods", () => {
  // Pega uma data de referência estável: 18/10/2026 13:30 local.
  const ref = new Date(2026, 9, 18, 13, 30, 0, 0);

  describe("startOfLocalDay", () => {
    it("zera horas, minutos, segundos e ms", () => {
      const out = startOfLocalDay(ref);
      expect(out.getHours()).toBe(0);
      expect(out.getMinutes()).toBe(0);
      expect(out.getSeconds()).toBe(0);
      expect(out.getMilliseconds()).toBe(0);
      expect(out.getFullYear()).toBe(2026);
      expect(out.getMonth()).toBe(9);
      expect(out.getDate()).toBe(18);
    });
  });

  describe("todayStart", () => {
    it("devolve meia-noite local", () => {
      const t = todayStart(ref);
      expect(t.getHours()).toBe(0);
      expect(t.getDate()).toBe(18);
    });
  });

  describe("periodStart", () => {
    it("today => meia-noite de hoje", () => {
      expect(periodStart("today", ref)).toEqual(startOfLocalDay(ref));
    });
    it("7d => 6 dias atrás, meia-noite", () => {
      const d = periodStart("7d", ref)!;
      expect(d.getDate()).toBe(12);
      expect(d.getHours()).toBe(0);
    });
    it("30d => 29 dias atrás, meia-noite", () => {
      const d = periodStart("30d", ref)!;
      expect(d.getDate()).toBe(19);
      expect(d.getMonth()).toBe(8); // setembro
      expect(d.getHours()).toBe(0);
    });
    it("month => dia 1 deste mês, meia-noite", () => {
      const d = periodStart("month", ref)!;
      expect(d.getDate()).toBe(1);
      expect(d.getMonth()).toBe(9);
      expect(d.getHours()).toBe(0);
    });
    it("all => null", () => {
      expect(periodStart("all", ref)).toBeNull();
    });
    it("passa de mês corretamente", () => {
      const d = periodStart("30d", new Date(2026, 0, 5, 9, 0, 0))!;
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(11);
      expect(d.getDate()).toBe(7);
    });
  });

  describe("periodStartMs", () => {
    it("retorna o mesmo valor que periodStart quando não é null", () => {
      expect(periodStartMs("7d", ref)).toBe(periodStart("7d", ref)!.getTime());
    });
    it("null para 'all'", () => {
      expect(periodStartMs("all", ref)).toBeNull();
    });
  });

  describe("listDailyDays", () => {
    it("today => 1 dia", () => {
      expect(listDailyDays("today", ref)).toHaveLength(1);
    });
    it("7d => 7 dias, terminando em hoje", () => {
      const days = listDailyDays("7d", ref);
      expect(days).toHaveLength(7);
      expect(days[days.length - 1]!.getDate()).toBe(18);
      expect(days[0]!.getDate()).toBe(12);
    });
    it("30d => 30 dias", () => {
      expect(listDailyDays("30d", ref)).toHaveLength(30);
    });
    it("month => 18 dias (1..18)", () => {
      const days = listDailyDays("month", ref);
      expect(days).toHaveLength(18);
      expect(days[0]!.getDate()).toBe(1);
      expect(days[days.length - 1]!.getDate()).toBe(18);
    });
    it("all => 365 dias (cap)", () => {
      expect(listDailyDays("all", ref)).toHaveLength(365);
    });
  });

  describe("daysInMonth", () => {
    it("outubro/2026 tem 31 dias", () => {
      expect(daysInMonth(ref)).toBe(31);
    });
    it("fevereiro/2026 tem 28 dias (não bissexto)", () => {
      expect(daysInMonth(new Date(2026, 1, 14))).toBe(28);
    });
  });

  describe("fractionOfDayElapsed", () => {
    it("0h00 => 0", () => {
      expect(fractionOfDayElapsed(new Date(2026, 9, 18, 0, 0, 0))).toBe(0);
    });
    it("23h59 => ~1", () => {
      expect(fractionOfDayElapsed(new Date(2026, 9, 18, 23, 59, 59))).toBeCloseTo(1, 3);
    });
    it("12h => ~0.5", () => {
      expect(fractionOfDayElapsed(new Date(2026, 9, 18, 12, 0, 0))).toBeCloseTo(0.5, 5);
    });
  });

  describe("elapsedMonthDays", () => {
    it("dia 1 00:00 => 0", () => {
      expect(elapsedMonthDays(new Date(2026, 9, 1, 0, 0, 0))).toBe(0);
    });
    it("dia 18 13:30 de mês 31 => 17.5625", () => {
      const v = elapsedMonthDays(new Date(2026, 9, 18, 13, 30, 0));
      // 17 dias cheios + 13.5h/24h = 17 + 0.5625 = 17.5625
      expect(v).toBeCloseTo(17.5625, 4);
    });
  });

  describe("dayKey", () => {
    it("formata YYYY-MM-DD", () => {
      expect(dayKey(new Date(2026, 0, 5, 9, 0, 0))).toBe("2026-01-05");
      expect(dayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
    });
  });
});