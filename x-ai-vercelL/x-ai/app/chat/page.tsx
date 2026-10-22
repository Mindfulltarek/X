import type { Metadata } from "next";

import { ChatApp } from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Chat and image-to-prompt workspace. Conversations are stored locally in your browser; every provider key stays on the server.",
};

export default function ChatPage() {
  return <ChatApp />;
}
