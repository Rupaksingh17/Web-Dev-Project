import { copyFile } from "node:fs/promises";

const outputDirectory = process.env.NEXT_DIST_DIR || ".next-build";
await copyFile("customHttp.yml", `${outputDirectory}/customHttp.yml`);
