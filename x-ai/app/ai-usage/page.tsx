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
          that forwards your request to whichever AI providers the site operator configured — any OpenAI-compatible
          endpoint, including gateway software such as OmniRoute. Those providers (or that gateway) supply the models and
          the quota; they must be set up and paid for by the operator.
        </p>
      </PolicySection>

      <PolicySection title="How a model is selected">
        <p>
          The server keeps a list of every model its providers actually expose, together with the capabilities each one
          declares (text, vision, coding, reasoning, image output, web grounding). You can pick a model explicitly, or
          leave it on <strong>Auto</strong>: the router classifies your request, drops any model that cannot serve it,
          and picks one based on capability fit, operator priority, latency and published price.
        </p>
        <p>
          If the chosen model is unavailable, rate-limited, out of credit or times out, the server may fall back to
          another model that is eligible for the same request. Auth and configuration errors are never retried, retries
          are bounded, and a fallback is only made between models the operator legitimately configured. It never tries to
          bypass a provider&apos;s limits, account restrictions or terms.
        </p>
        <p>
          When the operator enables multi-model review, an analysis or coding answer can be checked by a second model on
          a different provider. That report is shown to you with the answer; if the second model or the comparison step
          fails, the primary answer is kept and the failure is stated rather than hidden.
        </p>
      </PolicySection>

      <PolicySection title="Two different capabilities">
        <p>
          <strong>Image understanding</strong> (reading a picture to write a prompt) and{" "}
          <strong>image generation</strong> (creating a new picture) are separate capabilities. A model that can chat
          may not read images, and a chat model usually cannot return image bytes. X AI reads the capability metadata
          each provider publishes, sends images only to models that declare vision support, and tells you plainly when
          no such model is configured instead of dropping the image silently.
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
          Image generation is available only if this deployment has an image-capable model among its providers, or a
          configured ComfyUI server. It may be slower, may cost money, and is not guaranteed to be enabled.
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
          Because a site hosted on a serverless platform cannot reach a service running on someone&apos;s local machine,
          a production deployment needs provider endpoints (or a gateway such as OmniRoute) that are reachable from that
          host over HTTPS and authenticated with a server-side key. The repository README explains the options.
        </p>
        <p>
          See also the <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Use</Link>.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
