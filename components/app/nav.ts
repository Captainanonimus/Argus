export type NavItem = { key: string; href: string; label: string; short: string; aliases: string[] };

// Order defines the Alt+N shortcut and the function-key bar.
export const NAV: NavItem[] = [
  { key: "1", href: "/dashboard", label: "Dashboard", short: "Dash", aliases: ["dashboard", "dash", "home", "terminal", "chart"] },
  { key: "2", href: "/alerts", label: "Alerts", short: "Alrt", aliases: ["alerts", "alert", "blotter", "queue", "cases"] },
  { key: "3", href: "/simulator", label: "Simulator", short: "Sim", aliases: ["simulator", "sim", "scenario", "scenarios", "demo"] },
  { key: "4", href: "/import", label: "Import", short: "Imp", aliases: ["import", "csv", "upload"] },
  { key: "5", href: "/rules", label: "Rules", short: "Rule", aliases: ["rules", "rule", "help", "docs"] },
  { key: "6", href: "/assistant", label: "Assistant", short: "Asst", aliases: ["assistant", "ai", "chat", "ask"] },
  { key: "7", href: "/settings", label: "Settings", short: "Set", aliases: ["settings", "keys", "config", "setup"] },
];

export function matchPage(input: string): NavItem | undefined {
  const q = input.trim().toLowerCase();
  if (!q) return undefined;
  return NAV.find((n) => n.aliases.includes(q)) ?? NAV.find((n) => n.label.toLowerCase().startsWith(q) && q.length >= 3);
}
