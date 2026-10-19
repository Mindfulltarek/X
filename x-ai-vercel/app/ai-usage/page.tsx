import type { Metadata } from "next";
import Link from "next/link";

import { PolicyLayout, PolicySection } from "@/components/policy/PolicyLayout";

export const metadata: Metadata = {
  title: "AI Provider & Usage",
  description: "How X AI routes requests, where models come from, and what affects quotas and capabilities.",
};

export default function AiUsagePage() {
  return (
    <PolicyLayout
      title="AI Provider & Usage"
      intro="Where the models come from, how routing works, and why “unlimited free AI” is not a claim this site makes."
    >
      <PolicySection title="X AI is an interface, not a model provider">
        <p>
          X AI does not host or train AI models and does not give away inference. It is a front end plus a small server
          that forwards your request to an OmniRoute gateway. OmniRoute is an open-source router: it does not create free
          inference either — it must be installed, configured and connected to provider accounts and keys by the site
          operator.
        </p>
      </PolicySection>

      <PolicySection title="How a model is selected">
        <p>
          You can choose an explicit model from the catalog returned by the gateway, or use <strong>Auto</strong>.
          Auto asks OmniRoute to route the request among the provider connections that operator has enabled, using its
          own routing and fallback logic. When an image is attached with Auto, X AI uses OmniRoute&apos;s documented{" "}
          <code className="rounded bg-white/10 px-1 font-mono text-xs">auto/vision</code> route so the request reaches a
          vision-capable model.
        </p>
        <p>
          If an explicit model is unavailable or rate-limited, the server may retry with another model from an ordered,
          operator-configured list — but only for retryable failures (rate limits, timeouts, selected server errors) and
          only among models that are legitimately configured on that gateway. It never tries to bypass a provider&apos;s
          limits, account restrictions or terms.
        </p>
      </PolicySection>

      <PolicySection title="Two different capabilities">
        <p>
          <strong>Image understanding</strong> (reading a picture to write a prompt) and{" "}
          <strong>image generation</strong> (creating a new picture) are separate capabilities. A model that can chat
          may not read images, and a chat model usually cannot return image bytes. X AI checks the capability flags the
          gateway publishes and tells you when the selected model cannot handle an image.
        </p>
      </PolicySection>

      <PolicySection title="Quotas, limits and cost">
        <p>
          Free tiers, trial credits, rate limits and paid quotas are set by each provider and can change at any time.
          Some providers require an account, a payment method or approval. Requests made through this site consume the
          operator&apos;s provider quota, so usage may be capped or limited by the operator, and the service may stop
          working when a quota runs out.
        </p>
        <p>
          Image generation is available only if this deployment has configured an image backend (an image model on the
          gateway, or a ComfyUI server). It may be slower, may cost money, and is not guaranteed to be enabled.
        </p>
      </PolicySection>

      <PolicySection title="What the site does not do">
        <ul className="list-disc space-y-1 pl-5">
          <li>It does not promise unlimited, free or unfiltered access to any model.</li>
          <li>It does not create provider accounts for you or bypass provider sign-up requirements.</li>
          <li>It does not guarantee that any specific model is available at any moment.</li>
          <li>It does not take responsibility for the accuracy of model output.</li>
        </ul>
      </PolicySection>

      <PolicySection title="Self-hosting note">
        <p>
          Because a site hosted on a serverless platform cannot reach a gateway running on someone&apos;s local machine,
          a production deployment needs an OmniRoute instance that is reachable from that host and protected (for
          example a private server with an API key, or an authenticated tunnel — never an unauthenticated dashboard
          exposed to the internet). The repository README explains the options.
        </p>
        <p>
          See also the <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Use</Link>.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
