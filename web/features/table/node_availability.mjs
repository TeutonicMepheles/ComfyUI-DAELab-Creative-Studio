// Extracted from the mature App Mode model; private host refresh remains integration-owned.
export const MODE_ALWAYS=0;
export function isNodeAvailableInAppMode(node){return Boolean(node)&&Number(node.mode??MODE_ALWAYS)===MODE_ALWAYS;}
