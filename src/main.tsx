import React from "react";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import App from "./App";
import {
  initAnalytics,
  analyticsEnabled,
  POSTHOG_TOKEN,
  posthogOptions,
} from "./lib/analytics";

// Wire window error capture (provider does posthog.init()).
initAnalytics();

const tree = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  analyticsEnabled && POSTHOG_TOKEN ? (
    <PostHogProvider apiKey={POSTHOG_TOKEN} options={posthogOptions}>
      {tree}
    </PostHogProvider>
  ) : (
    tree
  ),
);
