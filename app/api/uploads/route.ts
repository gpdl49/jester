import { parseBody, withAuth } from "@/lib/http/handler";
import { createUploadSchema } from "@/lib/media/schema";
import { createUpload } from "@/lib/media/service";

export const POST = withAuth(async (request, _context, user) => {
	const body = await parseBody(request, createUploadSchema);
	const created = await createUpload(body, user);
	return Response.json(created, { status: 201 });
});
