import {createTableEditor as createEditor} from '../features/table/view.js';
import {tableModel} from './table_model.mjs';
import {promptSourceHeader} from '../features/prompt/table_prompt_source_header.mjs';
import {preserveGenerationHistory} from '../features/generation/table_generation_history.mjs';
import {isPrompt,promptText} from '../features/prompt/table_prompt_model.mjs';
import {bindColumnAssets} from '../features/prompt/table_prompt_template.mjs';
import {addGenerationColumn} from '../features/generation/table_generation_model.mjs';
import {renderContentCell} from './table_content_view.mjs';
export function createTableEditor(options){return createEditor({...options,model:tableModel,columns:{promptSourceHeader,preserveGenerationHistory,isPrompt,promptText,bindColumnAssets,renderContentCell,addGenerationColumn}});}

export {tableDialog,tableButton,FIELD_LABELS} from '../features/table/editor_runtime.mjs';
