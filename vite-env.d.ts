/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOST_PASSWORD?: string;
  // Add other environment variables here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
