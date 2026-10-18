import { describe, expect, it } from "vitest";
import {
  crossedThresholds,
  monthProjection,
} from "@/lib/data/budget";
import type { UsdBrlRate } from "@/lib/data/types";

const RATE: UsdBrlRate = { rate: 5, updatedAt: "2026-10-18T00:00:00Z" };

describe("budget", () => {
  describe("monthProjection", () => {
    it("projeta linearmente até o fim do mês", () => {
      // 18/10/2026 (mês 31 dias) às 00:00 → 0 dias decorridos ⇒ mas safeElapsed=1e-3 ⇒ 0
      const p1 = monthProjection(100, new Date(2026, 9, 1, 0, 0, 0));
      expect(p1).toBeGreaterThan(0);

      // 18/10/2026 13:30 → elapsed = 17.5625; 100/17.5625 * 31
      const p2 = monthProjection(100, new Date(2026, 9, 18, 13, 30, 0));
      const expected = (100 / 17.5625) * 31;
      expect(p2).toBeCloseTo(expected, 4);
    });

    it("não estoura no início do mês (safeElapsed)", () => {
      const p = monthProjection(1, new Date(2026, 9, 1, 0, 0, 0));
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeLessThan(100_000);
    });
  });

  describe("crossedThresholds", () => {
    it("devolve [] quando não há limite", () => {
      expect(crossedThresholds(10, { currency: "USD" }, null, "daily")).toEqual([]);
    });

    it("devolve [0.8] entre 80% e 100%", () => {
      expect(crossedThresholds(0.85, { currency: "USD", daily: 1 }, null, "daily")).toEqual([0.8]);
    });

    it("devolve [1] >= 100%", () => {
      expect(crossedThresholds(1.5, { currency: "USD", daily: 1 }, null, "daily")).toEqual([1]);
    });

    it("converte o limite para USD quando currency é BRL", () => {
      // limite 5 BRL, rate 5 → 1 USD; custo 0.85 USD → ratio 0.85 → [0.8]
      expect(crossedThresholds(0.85, { currency: "BRL", daily: 5 }, RATE, "daily")).toEqual([0.8]);
    });

    it("devolve [] se a cotação for ausente e moeda for BRL", () => {
      expect(crossedThresholds(0.85, { currency: "BRL", daily: 5 }, null, "daily")).toEqual([]);
    });

    it("abaixo de 80% devolve []", () => {
      expect(crossedThresholds(0.5, { currency: "USD", daily: 1 }, null, "daily")).toEqual([]);
    });
  });
});