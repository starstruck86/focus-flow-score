import { createVersionHandler } from "../_shared/versionResponse.ts";

Deno.serve(createVersionHandler());
