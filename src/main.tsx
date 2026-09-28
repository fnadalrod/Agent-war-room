// Raíz de composición del front: conecta el store con los adaptadores de Tauri, o con los de
// demostración si la UI se abre fuera de la app (navegador, capturas, diseño).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WarRoomStore } from "./application/warRoomStore";
import { createDemo } from "./infrastructure/demoGateway";
import { localFilterStorage } from "./infrastructure/localFilterStorage";
import { tauriIntegrationGateway, tauriTerminalGateway, tauriWarRoomGateway } from "./infrastructure/tauriGateway";
import { App } from "./ui/App";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./ui/styles.css";

const insideTauri = "__TAURI_INTERNALS__" in window;
const demo = insideTauri ? null : createDemo();
const store = demo
  ? new WarRoomStore(demo.rooms, demo.integration, demo.terminals, localFilterStorage)
  : new WarRoomStore(tauriWarRoomGateway, tauriIntegrationGateway, tauriTerminalGateway, localFilterStorage);
void store.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
