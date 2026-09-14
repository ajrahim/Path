import { useStore } from "react-redux";
import type { RendererStore } from "@/state/RendererStore";

export const useRendererStore = useStore.withTypes<RendererStore>();
