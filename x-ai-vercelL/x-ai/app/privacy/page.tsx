import type { Metadata } from "next";
import Link from "next/link";

import { PolicyLayout, PolicySection } from "@/components/policy/PolicyLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How X AI handles local chat storage, images, and requests to connected AI providers.",
};

export default function PrivacyPage() {
  return (
    <PolicyLayout
      title="Privacy Policy"
      intro="A short, plain-language description of what happens to your messages, images and local data when you use X AI."
    >
      <PolicySection title="Who operates this site">
        <p>
          X AI is a self-hosted interface for one or more AI providers (directly, or through a gateway such as OmniRoute). The person or organisation that deployed this
          site controls the server, the configured providers and the logs. This page describes the software&apos;s
          behaviour, not a promise made by any third party.
        </p>
      </PolicySection>

      <PolicySection title="Chats are stored in your browser by default">
        <p>
          Conversations, messages and attached images are saved in your browser&apos;s IndexedDB on this device. There
          is no account, no login, and no server-side user chat database in this version. Preferences such as the
          selected model are kept in localStorage.
        </p>
        <p>
          Because this data lives on your device, it is not synced across devices and it can be lost: clearing your
          browser&apos;s site data, using private browsing, or reinstalling the browser may delete it permanently. You can
          delete a single chat or clear everything from the sidebar or Settings.
        </p>
      </PolicySection>

      <PolicySection title="Content you send is processed by AI providers">
        <p>
          When you send a message, the text and any attached image are transmitted to the AI provider (or providers)
          configured on this deployment&apos;s gateway so a model can process them. Provider retention, training
          practices, logging and privacy policies vary and are outside the control of X AI. Do not send sensitive
          personal, medical, financial or confidential information that you are not permitted to share.
        </p>
        <p>
          Requests are made from the server, not directly from your browser. The gateway API key is held in server
          environment variables and is never sent to the browser or stored in local storage.
        </p>
      </PolicySection>

      <PolicySection title="What the server may log">
        <p>
          The application logs limited diagnostic metadata — an internal request id, the route used, the model id, the
          response status class and the duration. Prompt text, image bytes and API keys are not logged by the
          application. Hosting platforms and the AI providers themselves (for example Vercel, or the model provider you are routed to) may keep their own
          infrastructure logs under their own policies.
        </p>
      </PolicySection>

      <PolicySection title="Cookies and tracking">
        <p>
          X AI sets no advertising or analytics cookies and loads no third-party trackers. Storage is limited to the
          local chat database and a small preferences key described above.
        </p>
      </PolicySection>

      <PolicySection title="Your choices">
        <p>
          You can delete individual chats, attached images, or all local data at any time in the app. Deleting local
          data does not remove copies that an AI provider may retain under its own policy, and it does not affect the
          site operator&apos;s infrastructure logs.
        </p>
      </PolicySection>

      <PolicySection title="Children">
        <p>
          The service is not intended for children. If you are below the age required to consent to data processing in
          your jurisdiction, do not use it.
        </p>
      </PolicySection>

      <PolicySection title="Changes">
        <p>
          This page may be updated when the software changes. The version you are reading applies to the build you are
          using. For questions about a specific deployment, contact the person who operates that deployment — the
          credit link in the footer identifies the developer, not the operator.
        </p>
        <p>
          See also the <Link href="/terms">Terms of Use</Link> and <Link href="/ai-usage">AI Provider &amp; Usage</Link>{" "}
          notes.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
