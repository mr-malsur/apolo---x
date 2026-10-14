import type { ScrollScrubScene, ScrollScrubTheme } from "@/components/scroll-scrub/scroll-scrub";

export const scrollScrubTheme: ScrollScrubTheme = {
  accent: "#2B4BB8",
  background: "#EFF3F8",
  ink: "#111A2B",
  muted: "#6B7486",
};

export const scrollScrubScenes: ScrollScrubScene[] = [
  {
    id: "evidence-archive",
    label: "The archive",
    kicker: "Research, connected",
    title: "Find the thread between papers.",
    body: "Compare what sources agree on, keep contradictions visible, and follow each claim back to the evidence behind it.",
    tags: ["Multi-document reasoning", "Source-linked claims"],
    clip: "/assets/world/apollo-journey.mp4",
    poster: "/assets/world/apollo-poster.png",
    mobileClip: "/assets/world/apollo-journey.mp4",
    mobilePoster: "/assets/world/apollo-poster.png",
    scroll: 2.2,
    linger: 0.12,
    objectPosition: "50% 50%",
    mobileObjectPosition: "50% 42%",
  },
];
