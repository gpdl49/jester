import type { TagCountDto, TagKind } from "@/lib/api/types";
import { db } from "@/lib/db";

/**
 * Returns tags sorted by count descending, then name ascending.
 * Only tags used by at least one non-rejected meme are returned.
 */
export async function getTagCounts(): Promise<TagCountDto[]> {
	const rows = await db().$queryRaw<
		Array<{ name: string; kind: TagKind; count: number | bigint }>
	>`
		SELECT
			t.name,
			t.kind,
			COUNT(mt.meme_id)::int AS count
		FROM tags t
		JOIN meme_tags mt ON mt.tag_id = t.id
		JOIN memes m ON m.id = mt.meme_id
		WHERE m.status != 'rejected'
		GROUP BY t.id, t.name, t.kind
		ORDER BY count DESC, t.name ASC
	`;

	return rows.map((r) => ({
		name: r.name,
		kind: r.kind,
		count: Number(r.count),
	}));
}
