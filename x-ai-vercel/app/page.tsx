import Link from "next/link";
import { ArrowRight, ImageIcon, MessagesSquare, ShieldCheck, Sparkles, Wand2 } from "lucide-react";

import { XBrand, XMark } from "@/components/brand/XMark";
import { ChatPreview } from "@/components/landing/ChatPreview";
import { ShaderBackground } from "@/components/landing/ShaderBackground";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const metadata = {
  title: "X AI — Your images, understood. Your ideas, generated.",
  description:
    "Turn a reference image into a highly detailed image-generation prompt, or chat with AI models through a configured OmniRoute gateway. Chats are saved in your browser.",
};

const capabilities = [
  {
    icon: Wand2,
    title: "Image → Prompt",
    body: "Upload one reference image and get a structured, highly detailed generation prompt: subject, composition, lighting, colour, texture, mood and negative constraints.",
    accent: "from-electric-500/25 to-transparent",
  },
  {
    icon: MessagesSquare,
    title: "Chat with AI",
    body: "Have a normal conversation with the model you pick. Context carries across turns, and answers stream in as they are produced.",
    accent: "from-cyan-accent/20 to-transparent",
  },
  {
    icon: ImageIcon,
    title: "Generate images",
    body: "Available only when the deployed backend actually supports it — an image model on your OmniRoute gateway or a configured ComfyUI server.",
    accent: "from-electric-300/20 to-transparent",
  },
];

const steps = [
  {
    title: "Choose a model, or Auto",
    body: "Auto lets your OmniRoute gateway route each request among the provider connections you configured. You can also pick one model explicitly.",
  },
  {
    title: "Send an image or a message",
    body: "Drop, paste or attach a single image, then send it with an instruction — or leave the message blank to get a full analysis prompt.",
  },
  {
    title: "Read, copy, refine, regenerate",
    body: "Every prompt block has a copy button. Ask for changes like “make it more photorealistic” and the answer is revised in context.",
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <ShaderBackground />

      {/* Header */}
      <header className="relative z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <Link href="/" aria-label="X AI home" className="rounded-2xl">
            <XBrand size={44} />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3" aria-label="Main">
            <a
              href="#how-it-works"
              className="hidden rounded-lg px-3 py-2 text-[0.95rem] font-medium text-ink-200 transition hover:text-white sm:block"
            >
              How it works
            </a>
            <a
              href="#capabilities"
              className="hidden rounded-lg px-3 py-2 text-[0.95rem] font-medium text-ink-200 transition hover:text-white md:block"
            >
              What you can do
            </a>
            <Link href="/chat" className="btn-3d px-6 py-2.5">
              Start
              <ArrowRight size={16} aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative px-6 pb-16 pt-12 sm:pt-20">
          <div className="relative z-10 mx-auto max-w-5xl text-center">
            <p className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-electric-300/40 bg-midnight-950/80 px-4 py-2 text-[0.82rem] font-medium text-ink-200">
              <Sparkles size={14} className="text-cyan-accent" aria-hidden />
              Image Prompt Studio · no account required
            </p>

            <h1 className="text-balance text-[2.5rem] font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4rem]">
              Your images. <span className="neon-blue">Understood.</span>
              <br className="hidden sm:block" /> Your ideas.{" "}
              <span className="bg-gradient-to-r from-[#9AD8FF] via-cyan-accent to-[#7FB2FF] bg-clip-text text-transparent drop-shadow-[0_0_24px_rgba(40,215,242,0.35)]">
                Generated.
              </span>
            </h1>

            <p className="mx-auto mt-7 max-w-2xl text-pretty text-lg font-medium leading-8 text-ink-200 sm:text-xl sm:leading-9">
              X AI analyses a reference image into a detailed generation prompt, and chats with the AI models connected
              to your own OmniRoute gateway. Chats are saved in this browser — no signup, ever.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/chat" className="btn-3d w-full px-10 py-4 text-lg sm:w-auto">
                Start
                <ArrowRight size={20} aria-hidden />
              </Link>
              <a href="#how-it-works" className="btn-3d-ghost w-full px-8 py-4 text-lg sm:w-auto">
                See how it works
              </a>
            </div>
            <p className="mt-5 text-sm font-medium text-ink-300">
              Opens the workspace immediately — no login, no onboarding screen.
            </p>
          </div>

          <div className="relative z-10 mt-16">
            <ChatPreview />
          </div>
        </section>

        {/* Capabilities */}
        <section id="capabilities" className="relative z-10 px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">What you can do</h2>
              <p className="mt-4 text-lg leading-8 text-ink-200">
                Three focused tools, one clean workspace. Capabilities depend on the models your gateway actually
                exposes.
              </p>
            </div>

            <ul className="mt-12 grid gap-6 md:grid-cols-3">
              {capabilities.map(({ icon: Icon, title, body, accent }) => (
                <li key={title} className="glass-card group relative overflow-hidden p-7">
                  <div
                    className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${accent} blur-2xl`}
                    aria-hidden
                  />
                  <span className="relative mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-electric-300/45 bg-electric-500/15 text-cyan-100 shadow-[0_0_22px_-4px_rgba(37,99,235,0.9)]">
                    <Icon size={22} aria-hidden />
                  </span>
                  <h3 className="relative text-xl font-semibold text-white">{title}</h3>
                  <p className="relative mt-3 text-[0.98rem] font-medium leading-7 text-ink-200">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="relative z-10 px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">How it works</h2>
                <p className="mt-4 max-w-md text-lg leading-8 text-ink-200">
                  Pick a model or leave it on Auto, send an image or a message, and read the answer. That is the whole
                  flow.
                </p>
                <p className="mt-5 max-w-md rounded-2xl border border-electric-300/30 bg-midnight-950/85 px-4 py-4 text-[0.92rem] font-medium leading-7 text-ink-200">
                  Provider quotas may apply. X AI does not include inference: every request is served by the providers
                  connected to the OmniRoute gateway that hosts this site, and those providers control their own limits,
                  availability and terms.
                </p>
                <div className="mt-7 flex items-center gap-3">
                  <XMark size={44} glow={false} />
                  <div className="h-px flex-1 bg-gradient-to-r from-electric-400/70 to-transparent" />
                </div>
              </div>

              <ol className="space-y-5">
                {steps.map((step, index) => (
                  <li key={step.title} className="glass-card flex gap-5 p-6">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-electric-300/50 bg-electric-500/15 text-lg font-bold text-cyan-100 shadow-[0_0_20px_-6px_rgba(40,215,242,0.9)]">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                      <p className="mt-2 text-[0.98rem] font-medium leading-7 text-ink-200">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section className="relative z-10 px-6 py-14">
          <div className="mx-auto max-w-4xl">
            <div className="glass-card flex flex-col gap-5 p-7 sm:flex-row sm:items-start">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-accent/40 bg-cyan-accent/15 text-cyan-100 shadow-[0_0_22px_-6px_rgba(40,215,242,0.9)]">
                <ShieldCheck size={22} aria-hidden />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">Where your data goes</h2>
                <p className="mt-3 text-[0.98rem] font-medium leading-7 text-ink-200">
                  Chats and attached images are stored in this browser on this device by default, and you can delete
                  them at any time. Clearing browser data may delete them permanently — there is no account and no sync.
                </p>
                <p className="mt-3 text-[0.98rem] font-medium leading-7 text-ink-200">
                  When you send a message or image, that content is sent to the AI provider configured on this
                  deployment&apos;s gateway for processing. Provider retention and policies vary. This is not a
                  zero-processing service.
                </p>
                <p className="mt-4 text-sm font-medium text-ink-300">
                  Read the{" "}
                  <Link href="/privacy" className="text-cyan-200 underline underline-offset-2 hover:text-white">
                    Privacy Policy
                  </Link>
                  ,{" "}
                  <Link href="/terms" className="text-cyan-200 underline underline-offset-2 hover:text-white">
                    Terms of Use
                  </Link>{" "}
                  and{" "}
                  <Link href="/ai-usage" className="text-cyan-200 underline underline-offset-2 hover:text-white">
                    AI Provider &amp; Usage
                  </Link>{" "}
                  notes.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Second Start CTA */}
        <section className="relative z-10 px-6 pb-20 pt-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="glass-card px-6 py-10">
              <XMark size={56} className="mx-auto mb-5" />
              <h2 className="text-2xl font-bold text-white sm:text-3xl">Ready when you are</h2>
              <p className="mx-auto mt-3 max-w-xl text-[0.98rem] font-medium leading-7 text-ink-200">
                Open the workspace and send your first image. Nothing to install, nothing to sign up for.
              </p>
              <Link href="/chat" className="btn-3d mx-auto mt-7 px-10 py-4 text-lg">
                Start
                <ArrowRight size={20} aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
