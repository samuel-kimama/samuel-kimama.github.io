export const siteContent = {
  about: [
    "My work sits where product complexity, team scale, and frontend architecture collide. Companies call me when they need stronger foundations: component contracts, BFFs that absorb backend churn, and design systems that survive team growth.",
    "Across SaaS platforms, enterprise modernization, ML-enabled products, and consumer systems at LinkedIn scale, I work beyond feature delivery. I define architecture, negotiate API contracts with backend partners (GraphQL/BFF where it earns its keep), raise the performance and accessibility bar, and make the frontend a first-class layer instead of a thin client.",
    "The throughline is leverage. Strong systems compound — reducing friction for users and drag for engineers, and making future product bets easier to execute."
  ],
  availabilityEyebrow: "Open to roles",
  availability:
    "Open to remote frontend roles with end-to-end product and platform ownership.",
  expertise: [
    {
      title: "Architecture",
      description:
        "I design frontend foundations that support independent team delivery: component systems, API contracts, boundaries, migration plans, and maintainable patterns."
    },
    {
      title: "Platform Leverage",
      description:
        "I build standards, tooling, workflows, and shared UI infrastructure that improve velocity, reduce friction, and raise quality across the organization."
    },
    {
      title: "Complex Product Delivery",
      description:
        "I work effectively in ambiguous domains, especially where data-heavy workflows, ML systems, security requirements, or enterprise integrations shape the UI."
    }
  ],
  projects: [
    {
      name: "Etch",
      category: "Browser Extension",
      year: "2026",
      href: "https://k-leumas.github.io/etch-extension/",
      description:
        "Bookmark and navigate moments in LLM conversations. A selectorless, geometry-based architecture keeps bookmarks resilient to UI changes across Claude and ChatGPT. Same problem space as my WitnessAI work — durable hooks into AI chat UIs you don't control."
    },
    {
      name: "QueQue",
      category: "Developer Tooling",
      year: "2026",
      // TODO: swap href to GitHub Pages site when it ships
      href: "https://github.com/k-leumas/queque",
      media: {
        src: "/queque-demo.mp4",
        alt: "QueQue terminal demo: triggering the ?? prompt and getting a synthesized command."
      },
      description:
        "A terminal-native AI command synthesizer, triggered with `??`. Meets you mid-thought — describe what you're trying to do and get the command, right in your shell."
    },
  ]
};
