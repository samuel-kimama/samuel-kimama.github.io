import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import pdf from "astro-pdf";

const customDomain = existsSync("./public/CNAME")
  ? readFileSync("./public/CNAME", "utf-8").trim()
  : "";

const site = process.env.PUBLIC_SITE_URL
  || (customDomain ? `https://${customDomain}` : "https://samuel-kimama.github.io");
const isCI = process.env.CI === "true";

export default defineConfig({
  site,
  output: "static",
  integrations: [
    icon({
      include: {
        mdi: ["linkedin", "github"],
        lucide: ["download", "moon", "sun", "external-link"],
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
