import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    // Component unit tests inspect behavior, not Tailwind output. Next's
    // plugin-name PostCSS configuration is not a Vite PostCSS plugin list.
    css: { postcss: { plugins: [] } },
    test: {
        environment: 'node',
        include: ['**/__tests__/**/*.test.ts'],
        exclude: ['node_modules/**', '.next/**'],
        globals: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, './'),
            // Mirror Next's server marker for node-only component/schema tests.
            'server-only': path.resolve(import.meta.dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
        },
    },
})
