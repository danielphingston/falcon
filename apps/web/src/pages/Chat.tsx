import { ChatPanel } from "../components/ChatPanel";

export function ChatPage() {
  // Fill the viewport between the page top and the phone tab bar.
  return (
    <div className="h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-6.5rem)] md:h-[calc(100dvh-4.5rem)]">
      <ChatPanel />
    </div>
  );
}
