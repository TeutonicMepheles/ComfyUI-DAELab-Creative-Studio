/** Test-only controls. Importing these observers never starts observation,
 * reads the host graph, or sends a request. The operator starts each session.
 */
import { mountTableSemanticObserver } from './performance_table_semantic.js';
import { mountAssetSearchPerformanceObserver } from './performance_asset_search.js';

function mount() {
  mountTableSemanticObserver(document, window);
  mountAssetSearchPerformanceObserver(document, window);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
