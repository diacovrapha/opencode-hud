import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BarChart3,
  Bot,
  Boxes,
  CalendarRange,
  ChevronLeft,
  Cpu,
  FolderGit2,
  ListTree,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SidebarSection =
  | "overview"
  | "models"
  | "agents"
  | "projects"
  | "sessions"
  | "settings";

type SidebarProps = {
  active: SidebarSection;
  onChange: (s: SidebarSection) => void;
};

const SECTIONS: Array<{
  key: SidebarSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "overview", label: "Visão geral", icon: BarChart3 },
  { key: "models", label: "Modelos", icon: Cpu },
  { key: "agents", label: "Agentes", icon: Bot },
  { key: "projects", label: "Projetos", icon: FolderGit2 },
  { key: "sessions", label: "Sessões", icon: ListTree },
  { key: "settings", label: "Configurações", icon: SettingsIcon },
];

export function Sidebar({ active, onChange }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <aside
      className={cn(
        "glass-strong flex shrink-0 flex-col border-r border-white/5 transition-[width] duration-300",
        collapsed ? "w-[64px]" : "w-[200px]",
      )}
    >
      <div className="flex items-center justify-end border-b border-white/5 p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((c) => !c)}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <motion.span
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.25 }}
            className="inline-flex"
          >
            <ChevronLeft className="h-4 w-4" />
          </motion.span>
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.key;
            return (
              <li key={s.key}>
                <button
                  onClick={() => onChange(s.key)}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-all",
                    isActive
                      ? "bg-gradient-to-r from-violet-500/20 to-blue-500/10 text-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                  title={collapsed ? s.label : undefined}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-violet-400 to-blue-400"
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive && "text-violet-300",
                    )}
                  />
                  <AnimatePresence initial={false}>
                    {!collapsed && (
                      <motion.span
                        key="label"
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        transition={{ duration: 0.15 }}
                        className="truncate"
                      >
                        {s.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/5 p-3 text-[11px] text-muted-foreground">
        {collapsed ? (
          <div className="flex justify-center">
            <Boxes className="h-4 w-4 opacity-60" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CalendarRange className="h-3.5 w-3.5 opacity-60" />
            <span>v{__APP_VERSION__}</span>
          </div>
        )}
      </div>
    </aside>
  );
}