import {
  BookOpen,
  Bug,
  Clipboard,
  Code,
  FileCode2,
  FileText,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  Sparkles,
  type LucideProps,
} from "lucide-react";
import type { InstructionFlowIcon } from "@path/shared";

const glyphs = {
  "book-open": BookOpen,
  "file-code": FileCode2,
  "message-square": MessageSquareText,
  "file-text": FileText,
  "list-checks": ListChecks,
  bug: Bug,
  lightbulb: Lightbulb,
  clipboard: Clipboard,
  code: Code,
  sparkles: Sparkles,
} satisfies Record<InstructionFlowIcon, typeof FileText>;

/** One icon mapping is shared by the prompt editor, library, and document dropdown. */
export function InstructionFlowGlyph({
  icon,
  ...props
}: LucideProps & { icon: InstructionFlowIcon }) {
  const Glyph = glyphs[icon];

  return <Glyph {...props} />;
}
