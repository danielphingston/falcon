import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { finishRedirectSignIn } from "./lib/google";
import { syncNow } from "./lib/sync";
import { toast } from "./lib/toast";
import { Layout } from "./components/Layout";
import { TodayPage } from "./pages/Today";
import { EngagementsPage } from "./pages/Engagements";
import { EngagementPage } from "./pages/Engagement";
import { FollowUpsPage } from "./pages/FollowUps";
import { ReviewPage } from "./pages/Review";
import { PeoplePage } from "./pages/People";
import { SettingsPage } from "./pages/Settings";
import { NotFound } from "./pages/NotFound";
import { TimePage } from "./pages/Time";
import { ChatPage } from "./pages/Chat";
import { ReportsPage } from "./pages/Reports";
import { ProgressPage } from "./pages/Progress";
import { MorePage } from "./pages/More";

// Returning from Google's redirect sign-in: this strips the token from the URL
// synchronously, so it must run before the router reads the location.
void finishRedirectSignIn().then((r) => {
  if (r === null) return;
  if (typeof r === "string") return void toast({ message: r, tone: "error", duration: 8000 });
  toast({ message: `Connected as ${r.email ?? "your Google account"}`, tone: "success" });
  void syncNow();
});

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { index: true, element: <TodayPage /> },
        { path: "engagements", element: <EngagementsPage /> },
        { path: "engagements/:id", element: <EngagementPage /> },
        { path: "engagements/:id/:tab", element: <EngagementPage /> },
        { path: "followups", element: <FollowUpsPage /> },
        { path: "review", element: <ReviewPage /> },
        { path: "chat", element: <ChatPage /> },
        { path: "time", element: <TimePage /> },
        { path: "reports", element: <ReportsPage /> },
        { path: "progress", element: <ProgressPage /> },
        { path: "more", element: <MorePage /> },
        { path: "people", element: <PeoplePage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
