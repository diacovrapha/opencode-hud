import * as React from "react";
import { Dashboard } from "@/views/Dashboard";
import { Widget } from "@/views/Widget";

/**
 * Roteador minimalista baseado em hash, para que cada janela do Tauri
 * carregue uma "view" diferente sem precisar de react-router.
 *   - #/dashboard
 *   - #/widget
 *
 * O índice `#/` mostra a `Dashboard`.
 */
export function App(): React.JSX.Element {
  const [route, setRoute] = React.useState<string>(parseRoute());

  React.useEffect(() => {
    const onHash = (): void => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route === "widget") return <Widget />;
  return <Dashboard />;
}

function parseRoute(): string {
  const h = window.location.hash || "#/dashboard";
  const m = h.match(/^#\/([^?]+)/);
  return m ? m[1] : "dashboard";
}