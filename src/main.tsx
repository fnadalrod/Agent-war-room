// Raíz de composición del front: conecta el store con los adaptadores de Tauri.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WarRoomStore } from "./application/warRoomStore";
import { tauriIntegrationGateway, tauriWarRoomGateway } from "./infrastructure/tauriGateway";
import { App } from "./ui/App";
import "./ui/styles.css";

const store = new WarRoomStore(tauriWarRoomGateway, tauriIntegrationGateway);
void store.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
