import type { Metadata } from "next";
import { MemeDetail } from "@/components/memes/meme-detail";

export const metadata: Metadata = { title: "Meme Detail" };

export default async function Page({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	return <MemeDetail id={id} />;
}
