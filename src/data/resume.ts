import { getEntry } from "astro:content";

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00Z`));
}

export async function getResumeData() {
  const entry = await getEntry("resume", "resume");

  if (!entry) {
    throw new Error('Missing resume content entry "resume".');
  }

  const resume = entry.data;
  const profile = resume.profile;
  const strengths = resume.core_strengths;
  const technologies = resume.technologies;
  const socialLinks = [
    { label: "LinkedIn", href: profile.contact.linkedin },
    { label: "GitHub", href: profile.contact.github },
  ];
  const timeline = resume.experience.map((item) => ({
    period: `${formatMonth(item.start)} – ${formatMonth(item.end)}`,
    role: item.title,
    company: item.company,
    scope: item.scope ?? "",
    summary: item.summary,
    highlights: item.highlights,
    impact: item.impact,
    patents: item.patents,
  }));

  return {
    profile,
    strengths,
    technologies,
    socialLinks,
    stats: [
      { value: "16+", label: "years shipping frontend systems" },
      { value: "0→1", label: "frontend architecture built from scratch" },
      { value: "Staff+", label: "scope across product, platform, and org" },
    ],
    timeline,
  };
}
