// Extrai a configuração de agentes a partir de `agents/*.md` (frontmatter YAML)
// e do `opencode.jsonc` (model/agent defaults).
//
// Erros aqui NUNCA devem quebrar o snapshot — qualquer falha é logada e
// retornamos a lista parcial.

import yaml from "js-yaml";

import type { AgentConfig } from "./types";

/** Faz o parse de um arquivo Markdown com frontmatter YAML e retorna os campos básicos. */
export function parseAgentMd(name: string, body: string): AgentConfig {
  const out: AgentConfig = {
    name: stripMdExt(name),
    model: "",
    mode: "subagent",
  };
  const fm = extractFrontmatter(body);
  if (fm === null) return out;
  let parsed: unknown;
  try {
    parsed = yaml.load(fm);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const obj = parsed as Record<string, unknown>;
  const model = obj["model"];
  if (typeof model === "string") out.model = model;
  const mode = obj["mode"];
  if (mode === "primary" || mode === "subagent") out.mode = mode;
  return out;
}

/** Remove a extensão `.md` do nome do arquivo. */
export function stripMdExt(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** Extrai o conteúdo entre o primeiro par de `---` no topo do arquivo. */
export function extractFrontmatter(body: string): string | null {
  // aceita \r\n e \n; ^--- com flag m
  const m = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  return m ? (m[1] ?? "") : null;
}

/**
 * Faz o parse do `opencode.jsonc` removendo comentários `//` e `/* *\/` e
 * blocos `/* *\/` antes de delegar para `JSON.parse`.
 */
export function parseJsonc(text: string): Record<string, unknown> | null {
  // Remove /* ... */ primeiro (multilinha), depois // ... até fim da linha.
  // Mantém strings JSON intactas.
  const stripped: string[] = [];
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      stripped.push(ch!);
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      stripped.push(ch!);
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    stripped.push(ch!);
    i++;
  }
  try {
    const j = JSON.parse(stripped.join("")) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return j as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Combina a info de `agents/*.md` com o `opencode.jsonc` para gerar uma lista
 * unificada de `AgentConfig`. Agentes definidos só no JSONC (ex.: "general",
 * "explore") são incluídos.
 */
export function extractAgentsConfig(
  agentsJson: string,
  configJson: string,
): AgentConfig[] {
  const out: AgentConfig[] = [];

  // 1) Parse dos arquivos .md
  let agentsRaw: Record<string, string> = {};
  try {
    const parsed = JSON.parse(agentsJson) as Record<string, unknown>;
    for (const [name, val] of Object.entries(parsed)) {
      if (typeof val === "string") agentsRaw[name] = val;
    }
  } catch {
    // silencioso
  }
  const seen = new Set<string>();
  for (const [file, body] of Object.entries(agentsRaw)) {
    try {
      const cfg = parseAgentMd(file, body);
      out.push(cfg);
      seen.add(cfg.name);
    } catch {
      // silencioso
    }
  }

  // 2) Parse do opencode.jsonc para agentes/agent overrides
  let cfgRoot: Record<string, unknown> | null = null;
  try {
    cfgRoot = parseJsonc(configJson);
  } catch {
    // silencioso
  }
  if (cfgRoot) {
    // .agent.<name>: pode definir mode/model.
    const agentObj = cfgRoot["agent"];
    if (agentObj && typeof agentObj === "object" && !Array.isArray(agentObj)) {
      for (const [name, defRaw] of Object.entries(agentObj as Record<string, unknown>)) {
        const def = (defRaw ?? {}) as Record<string, unknown>;
        const model = typeof def["model"] === "string" ? def["model"] : "";
        const mode = def["mode"] === "primary" ? "primary" : def["mode"] === "subagent" ? "subagent" : undefined;
        if (!seen.has(name)) {
          out.push({ name, model, mode: mode ?? "subagent" });
          seen.add(name);
        } else {
          const idx = out.findIndex((a) => a.name === name);
          if (idx >= 0) {
            const cur = out[idx]!;
            if (!cur.model && model) cur.model = model;
            if (mode) cur.mode = mode;
          }
        }
      }
    }
  }

  // Dedup + ordenação estável
  const map = new Map<string, AgentConfig>();
  for (const a of out) if (!map.has(a.name)) map.set(a.name, a);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}