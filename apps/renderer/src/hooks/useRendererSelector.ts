import { useSelector } from "react-redux";
import type { RendererState } from "@/state/RendererStore";

export const useRendererSelector = useSelector.withTypes<RendererState>();
