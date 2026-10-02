import { withOwner } from "@/lib/auth-guard";
import { ValidationError } from "@/lib/errors";
import { extractAttachment } from "@/lib/services/attachments";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Reads one uploaded file into text; the client attaches the result to the next chat message. */
export const POST = withOwner(async (req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ValidationError("No file was uploaded.");
  return Response.json(await extractAttachment(file));
});
