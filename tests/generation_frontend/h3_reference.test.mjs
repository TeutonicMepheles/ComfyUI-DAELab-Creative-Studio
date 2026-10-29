import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTable} from '../../web/features/table/data_table_model.mjs';
import {LOCAL_REFERENCE_VIDEO_MODEL,LOCAL_VIDEO_MODEL,isLocalGenerationModel,isLocalVideoModel,GENERATION_MODELS,addGenerationColumn,generationInput} from '../../web/features/generation/table_generation_model.mjs';
import {bindLinkedTaskReference} from '../../web/features/generation/video_task_linked_prompt.mjs';

test('local reference model retains ordered images through table and standalone linked input',()=>{
 const table=normalizeTable({fields:[{id:'refs',type:'content',name:'Images',videoInput:'reference_images'}],records:[{id:'row',values:{refs:[{id:'a',kind:'image',url:'/view?filename=a.png'},{id:'b',kind:'image',url:'/view?filename=b.png'}]}}]});
 const field=addGenerationColumn(table),row=table.records[0];
 field.generation={...field.generation,kind:'video',model:LOCAL_REFERENCE_VIDEO_MODEL,mode:'image2video',settings:{width:512,height:288,duration:1.5,turbo:false,seed:7}};
 row.values[field.generation.promptFieldId]='Use both reference images.';
 bindLinkedTaskReference(table,row,field.id,field.generation,table.fields.find(f=>f.id==='refs'));
 const input=generationInput(table,field.id,row.id);
 assert.equal(input.config.mode,'image2video');
 assert.deepEqual(input.assets.map(a=>a.id),['a','b']);
 assert.equal(isLocalGenerationModel(input.config.model),true);
 assert.equal(isLocalVideoModel(input.config.model),true);
 assert.ok(GENERATION_MODELS.video.includes(input.config.model));
 assert.throws(()=>bindLinkedTaskReference(table,row,field.id,{...field.generation,model:LOCAL_VIDEO_MODEL},table.fields.find(f=>f.id==='refs')),/FL/);
});
