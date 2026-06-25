import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const resume = defineCollection({
  loader: glob({ base: "./src/data", pattern: "resume.yaml" }),
  schema: z.object({
    profile: z.object({
      name: z.string(),
      headline: z.string(),
      level: z.string(),
      location: z.string(),
      contact: z.object({
        email: z.string(),
        linkedin: z.string(),
        github: z.string().optional(),
        website: z.string().optional(),
      }),
      summary: z.string(),
    }),
    core_strengths: z.array(z.string()),
    experience: z.array(
      z.object({
        company: z.string(),
        title: z.string(),
        scope: z.string().optional(),
        location: z.string().optional(),
        start: z.string(),
        end: z.string(),
        summary: z.string(),
        highlights: z.array(z.string()),
        impact: z.string(),
        patents: z.array(z.object({
          title: z.string(),
          description: z.string(),
          number: z.string(),
          issued: z.string(),
          assignee: z.string(),
          href: z.string(),
          full_title: z.string().optional(),
        })).optional(),
      }),
    ),
    technologies: z.array(z.string()),
  }),
});

export const collections = { resume };
