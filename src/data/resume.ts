import { getEntry } from "astro:content";

declare const __RESUME_CONTACT__: {
  email?: string;
  linkedin?: string;
  website?: string;
  github?: string;
};

type SocialLink = {
  label: string;
  href: string;
};

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00Z`));
}

const contactPlaceholders = new Set(["EMAIL", "LINKEDIN_PROFILE_URL", "PUBLIC_SITE_URL", "GH_PROFILE_URL"]);

function resolveContactValue(fallback?: string, value?: string) {
  const resolved = value?.trim();
  const defaultValue = fallback?.trim() ?? "";

  if (resolved) {
    return resolved;
  }

  return contactPlaceholders.has(defaultValue) ? "" : defaultValue;
}

export async function getResumeData() {
  const entry = await getEntry("resume", "resume");

  if (!entry) {
    throw new Error('Missing resume content entry "resume".');
  }

  const resume = entry.data;
  const profile = {
    ...resume.profile,
    contact: {
      ...resume.profile.contact,
      email: resolveContactValue(resume.profile.contact.email, __RESUME_CONTACT__.email),
      linkedin: resolveContactValue(resume.profile.contact.linkedin, __RESUME_CONTACT__.linkedin),
      github: resolveContactValue(resume.profile.contact.github, __RESUME_CONTACT__.github),
      website: resolveContactValue(resume.profile.contact.website, __RESUME_CONTACT__.website),
    },
  };
  const strengths = resume.core_strengths;
  const technologies = resume.technologies;
  const socialLinks = [
    profile.contact.linkedin && { label: "LinkedIn", href: profile.contact.linkedin },
    profile.contact.github && { label: "GitHub", href: profile.contact.github },
  ].filter(Boolean) as SocialLink[];
  const timeline = resume.experience.map((item) => ({
    period: `${formatMonth(item.start)} – ${formatMonth(item.end)}`,
    role: item.title,
    company: item.company,
    location: item.location,
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
