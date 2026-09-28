/**
 * Jest mock for sanitize-html.
 *
 * sanitize-html@2.17.2+ depends on htmlparser2@10.x, which is ESM-only.
 * Jest's default transformer cannot parse ESM in node_modules, causing
 * "Cannot use import statement outside a module" in every suite that
 * transitively imports the app.
 *
 * This mock is registered in jest.config.ts via moduleNameMapper. Suites
 * that need real sanitization behavior (e.g. posts.service.test.ts)
 * declare their own local jest.mock('sanitize-html', ...), which takes
 * priority over this global mock.
 */
const sanitizeHtml = (input: string): string => input;

export default sanitizeHtml;