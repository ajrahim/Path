import { z } from "zod";

export const MAX_GUIDE_CONTEXT_ITEMS = 4;
export const MAX_GUIDE_CONTEXT_TEXT_LENGTH = 20_000;
export const MAX_GUIDE_CONTEXT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_GUIDE_CONTEXT_IMAGE_DIMENSION = 1600;

export const guideContextItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(MAX_GUIDE_CONTEXT_TEXT_LENGTH),
  }),
  z.strictObject({
    kind: z.literal("image"),
    name: z.string().trim().min(1).max(255),
    dataUrl: z
      .string()
      .max(Math.ceil(MAX_GUIDE_CONTEXT_IMAGE_BYTES / 3) * 4 + 22)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  }),
]);

export type GuideContextItem = z.infer<typeof guideContextItemSchema>;
