import type { JobDefinition } from "@/lib/jobs/define";
import { analysisMeme } from "@/lib/jobs/definitions/analysis-meme";
import { attributionFind } from "@/lib/jobs/definitions/attribution-find";
import { immichDelete } from "@/lib/jobs/definitions/immich-delete";
import { immichScan } from "@/lib/jobs/definitions/immich-scan";
import { importImmich } from "@/lib/jobs/definitions/import-immich";
import { importUpload } from "@/lib/jobs/definitions/import-upload";
import { instagramPublish } from "@/lib/jobs/definitions/instagram-publish";
import { instagramRefreshTokens } from "@/lib/jobs/definitions/instagram-refresh-tokens";
import { instagramRender } from "@/lib/jobs/definitions/instagram-render";
import { mediaRenditions } from "@/lib/jobs/definitions/media-renditions";
import { schedulerTick } from "@/lib/jobs/definitions/scheduler-tick";
import { systemPing } from "@/lib/jobs/definitions/system-ping";
import { triageClassify } from "@/lib/jobs/definitions/triage-classify";

/** Every job type the worker handles (docs/memes.md "Jobs"). */
export const jobDefinitions: readonly JobDefinition[] = [
	systemPing,
	immichScan,
	immichDelete,
	triageClassify,
	importImmich,
	importUpload,
	mediaRenditions,
	analysisMeme,
	attributionFind,
	instagramRender,
	instagramPublish,
	instagramRefreshTokens,
	schedulerTick,
];
