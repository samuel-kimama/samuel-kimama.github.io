import { getEntry } from "astro:content";

declare const __RESUME_CONTACT__: {
  name?: string;
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

/** Formats a YYYY-MM (or YYYY) value as a four-digit year. */
function formatYear(value: string) {
  return value.slice(0, 4);
}

const envPlaceholders = new Set([
  "NAME",
  "EMAIL",
  "LINKEDIN_PROFILE_URL",
  "PUBLIC_SITE_URL",
  "GH_PROFILE_URL",
  "PM_LOOP_URL",
  "PM_LOOP_START",
]);

function resolveContactValue(fallback?: string, value?: string) {
  const resolved = value?.trim();
  const defaultValue = fallback?.trim() ?? "";

  if (resolved) {
    return resolved;
  }

  return envPlaceholders.has(defaultValue) ? "" : defaultValue;
}

/** Returns true when a resume value is an unresolved env placeholder token. */
function isEnvPlaceholder(value?: string) {
  const trimmed = value?.trim();
  return Boolean(trimmed && envPlaceholders.has(trimmed));
}

/** Formats a project start date, ignoring unresolved env placeholders. */
function formatProjectStart(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed || isEnvPlaceholder(trimmed)) {
    return undefined;
  }

  return formatMonth(trimmed);
}

export async function getResumeData() {
  const entry = await getEntry("resume", "resume");

  if (!entry) {
    throw new Error('Missing resume content entry "resume".');
  }

  const resume = entry.data;
  const profile = {
    ...resume.profile,
    name: resolveContactValue(resume.profile.name, __RESUME_CONTACT__.name),
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
  const projects = (resume.projects ?? []).map((item) => ({
    name: item.name,
    tagline: item.tagline,
    href: item.href && !isEnvPlaceholder(item.href) ? item.href : undefined,
    description: item.description,
    period: formatProjectStart(item.start),
    highlights: item.highlights,
  }));
  const education = {
    degree: resume.education.degree,
    school: resume.education.school,
    period:
      resume.education.start && resume.education.end
        ? `${formatYear(resume.education.start)} – ${formatYear(resume.education.end)}`
        : undefined,
  };
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
    projects,
    education,
    socialLinks,
    stats: [
      { value: "16+", label: "years shipping frontend systems" },
      { value: "0→1", label: "frontend architecture built from scratch" },
      { value: "Staff+", label: "scope across product, platform, and org" },
    ],
    timeline,
  };
}
