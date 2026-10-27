import {createTableModel} from '../features/table/index.js';
import {isPrompt,validatePrompt} from '../features/prompt/table_prompt_model.mjs';
import {isColumnPrompt,validateColumnPrompt,bindColumnAssets,toColumnPrompt} from '../features/prompt/table_prompt_template.mjs';
import {migratePromptSource,promptSourceId,setPromptSource} from '../features/prompt/table_prompt_source.mjs';
export const tableModel=createTableModel({isPrompt,validatePrompt,isColumnPrompt,validateColumnPrompt,bindColumnAssets,toColumnPrompt,migratePromptSource,promptSourceId,setPromptSource});
export const {COLUMN_MINIMUM_WIDTH,FIELD_TYPES,clone,uid,emptyValue,convertValue,normalizeTable,addField,removeField,addRecord,duplicateSelected,reorder,setValue,transferValue,parseTSV,pasteMatrix,encodeTSV,SnapshotHistory}=tableModel;
