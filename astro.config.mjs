import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import pdf from "astro-pdf";

const customDomain = existsSync("./public/CNAME")
  ? readFileSync("./public/CNAME", "utf-8").trim()
  : "";

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");

        return [key, value];
      }),
  );
}

const mode = process.env.MODE || process.env.NODE_ENV || "development";
const env = {
  ...readEnvFile(".env"),
  ...readEnvFile(".env.local"),
  ...readEnvFile(`.env.${mode}`),
  ...readEnvFile(`.env.${mode}.local`),
};
const getEnv = (key) => process.env[key] || env[key] || "";
const site = getEnv("PUBLIC_SITE_URL")
  || (customDomain ? `https://${customDomain}` : "https://samuel-kimama.github.io");
const isCI = getEnv("CI") === "true";

export default defineConfig({
  site,
  output: "static",
  vite: {
    define: {
      __RESUME_CONTACT__: JSON.stringify({
        email: getEnv("EMAIL"),
        linkedin: getEnv("LINKEDIN_PROFILE_URL"),
        website: getEnv("PUBLIC_SITE_URL"),
        github: getEnv("GH_PROFILE_URL"),
        book_me: getEnv("BOOK_ME_URL"),
      }),
    },
  },
  integrations: [
    icon({
      include: {
        mdi: ["linkedin", "github", "calendar"],
        lucide: ["download", "moon", "sun", "external-link", "mail", "globe"],
      },
    }),
    pdf({
      launch: isCI
        ? {
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          }
        : undefined,
      pages: {
        "/resume-pdf": {
          path: "/Samuel-Kimama-Resume.pdf",
          throwOnFail: true,
          pdf: {
            format: "Letter",
            printBackground: true,
            preferCSSPageSize: true,
          },
        },
      },
    }),
  ],
});
