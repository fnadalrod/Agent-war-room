// Front-end composition root: wires the store to the Tauri adapters, or to the demo ones when the UI
// is opened outside the app (browser, screenshots, design). Loaded by main.tsx once the language is set.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WarRoomStore } from "./application/warRoomStore";
import { createDemo } from "./infrastructure/demoGateway";
import { localFilterStorage } from "./infrastructure/localFilterStorage";
import { tauriIntegrationGateway, tauriTerminalGateway, tauriWarRoomGateway } from "./infrastructure/tauriGateway";
import { App } from "./ui/App";

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
