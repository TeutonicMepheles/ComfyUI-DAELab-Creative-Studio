import {mountTableRowScanDiagnostic} from './table_row_scan_diagnostic.js';

const mount = () => mountTableRowScanDiagnostic(document, window);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
else mount();
