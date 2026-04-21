import { Buffer } from "buffer";

if (typeof window !== "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  (window as unknown as { global: typeof globalThis }).global = window;
}
