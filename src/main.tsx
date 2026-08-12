import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider, resolveInitialLocale } from "./i18n";
import "./styles/tokens.css";
import "./styles/app.css";

async function bootstrap() {
  const startupLocale = resolveInitialLocale();
  if (startupLocale === "ru") {
    await import("monaco-editor/esm/nls.messages.ru.js");
  }

  const { default: App } = await import("./App");

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
