import type { Metadata } from "next";

import { ChatApp } from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Chat, image reading and image generation workspace. Conversations are stored locally in your browser; every provider key stays on the server.",
};

export default function ChatPage() {
  return <ChatApp />;
}
