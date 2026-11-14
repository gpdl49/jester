import type { MemeAnalysisResult } from "@/lib/api/types";
import { db } from "@/lib/db";
import type { Analysis, Prisma, TagKind } from "@/lib/generated/prisma/client";
import { memeAnalysisResultSchema, slugify } from "./schema";

function shouldUpdate(field: string, userEdited: string[]): boolean {
	const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	return !userEdited.includes(field) && !userEdited.includes(snake);
}

/**
 * Validates the analysis result, updates the Meme with AI fields (respecting userEdited),
 * and replaces AI tags with topics, styles, and template tags.
 */
export async function applyAnalysis(
	memeId: string,
	analysisId: string,
	rawResult: unknown,
	costUsd: number | null,
	model?: string,
): Promise<Analysis> {
	const result: MemeAnalysisResult = memeAnalysisResultSchema.parse(rawResult);

	return db().$transaction(async (tx) => {
		const meme = await tx.meme.findUniqueOrThrow({
			where: { id: memeId },
		});

		const dataToUpdate: Prisma.MemeUpdateInput = {};
		if (shouldUpdate("ocrText", meme.userEdited)) {
			dataToUpdate.ocrText = result.ocrText;
		}
		if (shouldUpdate("description", meme.userEdited)) {
			dataToUpdate.description = result.description;
		}
		if (shouldUpdate("altText", meme.userEdited)) {
			dataToUpdate.altText = result.altText;
		}
		if (shouldUpdate("template", meme.userEdited)) {
			dataToUpdate.template = result.template;
		}
		if (shouldUpdate("language", meme.userEdited)) {
			dataToUpdate.language = result.language;
		}
		if (shouldUpdate("era", meme.userEdited)) {
			dataToUpdate.era = result.era;
		}
		if (shouldUpdate("postability", meme.userEdited)) {
			dataToUpdate.postability = result.postability;
		}
		if (shouldUpdate("captionDraft", meme.userEdited)) {
			dataToUpdate.captionDraft = result.captionDraft;
		}
		if (shouldUpdate("hashtags", meme.userEdited)) {
			dataToUpdate.hashtags = result.hashtags;
		}
		if (shouldUpdate("sensitivity", meme.userEdited)) {
			dataToUpdate.sensitivity =
				result.sensitivity as unknown as Prisma.InputJsonValue;
		}
		if (shouldUpdate("quality", meme.userEdited)) {
			dataToUpdate.quality = result.quality as unknown as Prisma.InputJsonValue;
		}

		// Collect unique tags to upsert: topics -> topic, styles -> style, template -> template
		const tagsToUpsert = new Map<string, TagKind>();
		for (const topic of result.topics) {
			if (topic) tagsToUpsert.set(topic, "topic");
		}
		for (const style of result.styles) {
			if (style) tagsToUpsert.set(style, "style");
		}
		if (result.template) {
			const templateSlug = slugify(result.template);
			if (templateSlug) {
				tagsToUpsert.set(templateSlug, "template");
			}
		}

		// 1. Fetch user tags on this meme to ensure they are never touched
		const existingUserTags = await tx.memeTag.findMany({
			where: { memeId, source: "user" },
			select: { tagId: true },
		});
		const userTagIds = new Set(existingUserTags.map((t) => t.tagId));

		// 2. Delete previous AI tags for this meme
		await tx.memeTag.deleteMany({
			where: { memeId, source: "ai" },
		});

		// 3. Upsert tags into Tag table and link as MemeTag (source: ai)
		for (const [name, kind] of tagsToUpsert.entries()) {
			const tagRecord = await tx.tag.upsert({
				where: { name },
				create: { name, kind },
				update: {},
			});

			if (!userTagIds.has(tagRecord.id)) {
				await tx.memeTag.create({
					data: {
						memeId,
						tagId: tagRecord.id,
						source: "ai",
					},
				});
			}
		}

		// 4. Update the meme
		await tx.meme.update({
			where: { id: memeId },
			data: dataToUpdate,
		});

		// 5. Update analysis row to done
		return tx.analysis.update({
			where: { id: analysisId },
			data: {
				status: "done",
				result: result as unknown as Prisma.InputJsonValue,
				costUsd,
				...(model ? { model } : {}),
				error: null,
			},
		});
	});
}
