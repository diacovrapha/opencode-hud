import { describe, expect, it } from "vitest";
import {
  extractAgentsConfig,
  extractFrontmatter,
  parseAgentMd,
  parseJsonc,
  stripMdExt,
} from "@/lib/data/agents";

describe("agents", () => {
  describe("stripMdExt", () => {
    it("remove .md", () => {
      expect(stripMdExt("chefe.md")).toBe("chefe");
      expect(stripMdExt("foo")).toBe("foo");
    });
  });

  describe("extractFrontmatter", () => {
    it("extrai o frontmatter entre ---", () => {
      const body = `---
mode: primary
model: anthropic/claude-sonnet-5-5
---

# Corpo`;
      expect(extractFrontmatter(body)).toBe("mode: primary\nmodel: anthropic/claude-sonnet-5-5");
    });
    it("devolve null se não houver frontmatter", () => {
      expect(extractFrontmatter("só corpo\nsem front")).toBeNull();
    });
  });

  describe("parseAgentMd", () => {
    it("extrai mode e model do YAML", () => {
      const body = `---
mode: primary
model: anthropic/claude-sonnet-5-5
---`;
      const out = parseAgentMd("chefe.md", body);
      expect(out).toEqual({ name: "chefe", mode: "primary", model: "anthropic/claude-sonnet-5-5" });
    });
    it("default mode = subagent", () => {
      const out = parseAgentMd("pleno.md", "---\nmodel: x/y\n---");
      expect(out.mode).toBe("subagent");
    });
    it("tolera frontmatter inválido", () => {
      const out = parseAgentMd("foo.md", "---\n::invalid::\n---");
      expect(out).toEqual({ name: "foo", mode: "subagent", model: "" });
    });
  });

  describe("parseJsonc", () => {
    it("remove // comentários", () => {
      const text = `{
        // comentário
        "model": "x/y"
      }`;
      expect(parseJsonc(text)).toEqual({ model: "x/y" });
    });
    it("remove /* ... */", () => {
      const text = `/* bloco */
      { "a": 1 }`;
      expect(parseJsonc(text)).toEqual({ a: 1 });
    });
    it("preserva strings que contenham //", () => {
      const text = `{ "url": "https://example.com/foo" }`;
      expect(parseJsonc(text)).toEqual({ url: "https://example.com/foo" });
    });
    it("devolve null em JSON inválido", () => {
      expect(parseJsonc("{")).toBeNull();
    });
  });

  describe("extractAgentsConfig", () => {
    it("combina agents/*.md com overrides do jsonc", () => {
      const agents = JSON.stringify({
        "chefe.md": "---\nmode: primary\nmodel: a/b\n---",
        "pleno.md": "---\nmode: subagent\nmodel: a/c\n---",
      });
      const config = `{
        // comentário
        "model": "x/y",
        "agent": {
          "explore": { "model": "m/n" },
          "general": { "model": "p/q", "mode": "subagent" }
        }
      }`;
      const out = extractAgentsConfig(agents, config);
      const names = out.map((a) => a.name);
      expect(names).toContain("chefe");
      expect(names).toContain("pleno");
      expect(names).toContain("explore");
      expect(names).toContain("general");
      const explore = out.find((a) => a.name === "explore")!;
      expect(explore.model).toBe("m/n");
      expect(explore.mode).toBe("subagent");
    });

    it("não quebra com JSON quebrado", () => {
      const out = extractAgentsConfig("{not-json", "{not-json");
      expect(Array.isArray(out)).toBe(true);
    });
  });
});