import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
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
import { ReportsPage } from "./pages/Reports";
import { ProgressPage } from "./pages/Progress";
import { MorePage } from "./pages/More";

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
