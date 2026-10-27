import { createStructuredClipboard } from '../../../ui/structured_clipboard.js';
// Intentional cross-table clipboard exchange belongs to the host, not a current-editor singleton.
export const tableClipboard = createStructuredClipboard(text => navigator.clipboard.writeText(text));
