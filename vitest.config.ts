import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ["tests/unit/**/*.test.ts", "apps/api/test/**/*.test.ts"], passWithNoTests: false } });
