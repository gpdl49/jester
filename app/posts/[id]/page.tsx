import type { Metadata } from "next";
import { PostDetailPage } from "@/components/posts/post-detail-page";

export const metadata: Metadata = { title: "Post" };

/** Owned by the `posts` slice (docs/jester.md "Pages"). */
export default async function Page({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <PostDetailPage id={id} />;
}
