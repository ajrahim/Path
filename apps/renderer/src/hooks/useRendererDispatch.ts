import { useDispatch } from "react-redux";
import type { RendererDispatch } from "@/state/RendererStore";

export const useRendererDispatch = useDispatch.withTypes<RendererDispatch>();
