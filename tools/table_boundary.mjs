// The table pilot has a closed public surface. Adjacent features are migrated separately.
export const tablePublic=new Set(['index.ts','contracts.ts','core_model.mjs','view.ts','public_helpers.mjs']);
export const tableCompatibility=new Set(['data_table_model.mjs','data_table_editor.mjs','data_table_groups.mjs','daelab_studio_theme.mjs','list_editor_controls.mjs','table_content_view.mjs','table_context_menu.mjs','table_controls.mjs','table_exchange.mjs','table_inline_editor.mjs','table_material_columns.mjs','table_material_output.mjs','table_reference_menu.mjs','table_source_model.mjs','table_text_side.mjs','table_workbench.mjs','table_workbench_theme.mjs']);
const prefix='features/table/';
export function tableModuleErrors(relative,code){
 if(!relative.startsWith(prefix))return [];
 const name=relative.slice(prefix.length),errors=[];
 if(tableCompatibility.has(name)){
  const remaining=code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"][^'"]+['"]\s*;?/g,'').trim();
  if(remaining)errors.push(`${relative}: compatibility entry must only forward exports`);
 }else if(/(?:Symbol\.for\(['"]DAELAB|\b(?:globalThis|window)\.app\b)/.test(code))errors.push(`${relative}: table discovers a global host instead of injected capabilities`);
 return errors;
}
export function tableEdgeErrors(relative,target,{typeOnly=false}={}){
 const inside=relative.startsWith(prefix),targetInside=target.startsWith(prefix),name=target.slice(prefix.length),errors=[];
 if(targetInside&&!inside&&!tablePublic.has(name))errors.push(`${relative}: private table import ${target}; use a public entry`);
 const shim=inside&&tableCompatibility.has(relative.slice(prefix.length));
 if(inside&&!shim&&!typeOnly&&/^(?:application\/|integrations\/|features\/(?!table\/))/.test(target))errors.push(`${relative}: table implementation depends on composition ${target}`);
 if(inside&&!shim&&targetInside&&tableCompatibility.has(name))errors.push(`${relative}: table implementation imports a compatibility composition`);
 return errors;
}
