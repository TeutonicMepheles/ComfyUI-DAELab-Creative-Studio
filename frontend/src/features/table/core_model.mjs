import {createTableModelRuntime as createTableModel} from './model_runtime.mjs';
export {createTableModel};
export const {COLUMN_MINIMUM_WIDTH,FIELD_TYPES,clone,uid,emptyValue,convertValue,normalizeTable,addField,removeField,addRecord,duplicateSelected,reorder,setValue,transferValue,parseTSV,pasteMatrix,encodeTSV,SnapshotHistory}=createTableModel();
