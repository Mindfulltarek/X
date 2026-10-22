import type { Metadata } from "next";
import Link from "next/link";

import { PolicyLayout, PolicySection } from "@/components/policy/PolicyLayout";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms that apply to using X AI.",
};

export default function TermsPage() {
  return (
    <PolicyLayout
      title="Terms of Use"
      intro="Plain-language terms for using this X AI deployment. They are informational and are not legal advice."
    >
      <PolicySection title="Acceptable use">
        <p>
          Use X AI lawfully. Do not use it to generate or distribute content that is illegal in your jurisdiction, to
          harass or harm others, to infringe intellectual property, to attempt to access systems you are not authorised
          to access, or to circumvent provider limits, quotas or access controls.
        </p>
      </PolicySection>

      <PolicySection title="Provider terms still apply">
        <p>
          Every answer and image comes from a model provider connected to the gateway behind this site. Those providers
          have their own terms of service and usage policies, and your use of their models through X AI does not exempt
          you from them. Some providers require you not to resell access, not to use outputs for certain purposes, or
          to disclose that content is AI generated.
        </p>
      </PolicySection>

      <PolicySection title="Accuracy and outputs">
        <p>
          AI outputs can be wrong, incomplete or misleading. Image-analysis prompts are interpretations of a picture,
          not measurements — a text prompt cannot guarantee a pixel-perfect recreation. Verify anything important before
          relying on it, and treat generated images as synthetic content.
        </p>
      </PolicySection>

      <PolicySection title="Your content and responsibility">
        <p>
          You are responsible for the prompts you submit and for how you use the results, including any rights required
          to upload an image you send. Do not upload images of other people or confidential material without
          permission.
        </p>
      </PolicySection>

      <PolicySection title="Availability">
        <p>
          The service is provided as-is, without warranty. Availability depends on the configured providers, their
          quotas and the server hosting the gateway. Features such as image understanding and image generation only work
          when the connected models actually support them, and limits can change without notice.
        </p>
      </PolicySection>

      <PolicySection title="No accounts and no data recovery">
        <p>
          There is no account to recover. Local chats live in your browser; if they are cleared, they cannot be restored
          by the site. Use your own copy tools (the copy and download buttons) for anything you want to keep.
        </p>
      </PolicySection>

      <PolicySection title="Changes">
        <p>
          These terms may change with the software. Continued use after a change means you accept the updated terms.
        </p>
        <p>
          See also the <Link href="/privacy">Privacy Policy</Link> and{" "}
          <Link href="/ai-usage">AI Provider &amp; Usage</Link> notes.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
